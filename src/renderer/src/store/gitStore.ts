import { create } from 'zustand'
import { GIT_LOG_PAGE_SIZE } from '../../../shared/git'
import type { GitCommit, GitCommitDetail, GitStatus } from '../../../shared/git'

/** How long the file watcher must stay quiet before a status read is worth it. */
export const STATUS_DEBOUNCE_MS = 250

export interface GitStore {
  isRepo: boolean
  currentBranch: string
  branches: string[]
  detached: boolean
  loading: boolean
  error: string | null
  setBranches: (data: { current: string; branches: string[]; detached: boolean }) => void
  setIsRepo: (isRepo: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void

  /** Working-tree status of `statusPath`; null until the first read lands. */
  status: GitStatus | null
  /** The folder `status` describes — the sidebar shows one repo at a time. */
  statusPath: string | null
  statusLoading: boolean
  statusError: string | null
  refreshStatus: (folderPath: string) => Promise<void>
  scheduleStatusRefresh: (folderPath: string, delayMs?: number) => void
  clearStatus: () => void

  /** Commit history of `statusPath`, newest first, across all branches. */
  commits: GitCommit[]
  commitsLoading: boolean
  commitsError: string | null
  /** False once a page comes back shorter than asked for. */
  hasMoreCommits: boolean
  loadCommits: (folderPath: string) => Promise<void>
  loadMoreCommits: (folderPath: string) => Promise<void>
  /**
   * Per-commit file lists and line counts, fetched when a commit is opened or
   * hovered. Cached because a commit's contents cannot change.
   */
  commitDetails: Record<string, GitCommitDetail>
  loadCommitDetail: (folderPath: string, sha: string) => Promise<void>
}

/**
 * Guards against an out-of-order reply overwriting a newer one. Reads are
 * fired by a file watcher and by the user switching folders, so a slow status
 * on a big repo can easily land after a fast one for a different folder.
 */
let statusRequestId = 0
let statusTimer: ReturnType<typeof setTimeout> | null = null
/** Same guard for history: switching folders must not accept the old repo's log. */
let logRequestId = 0

export const useGitStore = create<GitStore>((set, get) => ({
  isRepo: false,
  currentBranch: '',
  branches: [],
  detached: false,
  loading: false,
  error: null,
  setBranches: (data) =>
    set({
      isRepo: true,
      currentBranch: data.current,
      branches: data.branches,
      detached: data.detached
    }),
  setIsRepo: (isRepo) => set({ isRepo }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = null
    statusRequestId++
    set({
      isRepo: false,
      currentBranch: '',
      branches: [],
      detached: false,
      loading: false,
      error: null,
      status: null,
      statusPath: null,
      statusLoading: false,
      statusError: null,
      commits: [],
      commitsLoading: false,
      commitsError: null,
      hasMoreCommits: false,
      commitDetails: {}
    })
  },

  status: null,
  statusPath: null,
  statusLoading: false,
  statusError: null,

  refreshStatus: async (folderPath) => {
    const requestId = ++statusRequestId
    // Only the very first read of a folder shows a spinner; later ones come
    // from the watcher and would make the section flicker on every keystroke
    // a terminal writes into a file.
    set({ statusLoading: get().statusPath !== folderPath })

    let result: Awaited<ReturnType<typeof window.electronAPI.gitStatus>>
    try {
      result = await window.electronAPI.gitStatus(folderPath)
    } catch {
      result = { ok: false, error: 'Failed to read status' }
    }
    if (requestId !== statusRequestId) return

    set(
      result.ok
        ? { status: result.status, statusPath: folderPath, statusError: null, statusLoading: false }
        : { status: null, statusPath: folderPath, statusError: result.error, statusLoading: false }
    )
  },

  scheduleStatusRefresh: (folderPath, delayMs = STATUS_DEBOUNCE_MS) => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = setTimeout(() => {
      statusTimer = null
      void get().refreshStatus(folderPath)
    }, delayMs)
  },

  clearStatus: () => {
    if (statusTimer) clearTimeout(statusTimer)
    statusTimer = null
    statusRequestId++
    set({
      status: null,
      statusPath: null,
      statusLoading: false,
      statusError: null,
      commits: [],
      commitsError: null,
      hasMoreCommits: false,
      commitDetails: {}
    })
  },

  commits: [],
  commitsLoading: false,
  commitsError: null,
  hasMoreCommits: false,

  loadCommits: async (folderPath) => {
    const requestId = ++logRequestId
    set({ commitsLoading: true, commitsError: null })

    const result = await readLog(folderPath, GIT_LOG_PAGE_SIZE, 0)
    if (requestId !== logRequestId) return

    set(
      result.ok
        ? {
            commits: result.commits,
            hasMoreCommits: result.commits.length === GIT_LOG_PAGE_SIZE,
            commitsError: null,
            commitsLoading: false,
            // The history belongs to the folder that was asked for; a cached
            // detail from another repo would be a different commit entirely.
            commitDetails: {}
          }
        : { commits: [], hasMoreCommits: false, commitsError: result.error, commitsLoading: false }
    )
  },

  loadMoreCommits: async (folderPath) => {
    const { commits, commitsLoading, hasMoreCommits } = get()
    if (commitsLoading || !hasMoreCommits) return

    const requestId = ++logRequestId
    set({ commitsLoading: true })

    const result = await readLog(folderPath, GIT_LOG_PAGE_SIZE, commits.length)
    if (requestId !== logRequestId) return

    set(
      result.ok
        ? {
            // Appended rather than replaced, so the graph lanes already drawn
            // above stay put.
            commits: [...get().commits, ...result.commits],
            hasMoreCommits: result.commits.length === GIT_LOG_PAGE_SIZE,
            commitsLoading: false
          }
        : { commitsError: result.error, commitsLoading: false, hasMoreCommits: false }
    )
  },

  commitDetails: {},

  loadCommitDetail: async (folderPath, sha) => {
    if (get().commitDetails[sha]) return

    let result: Awaited<ReturnType<typeof window.electronAPI.gitCommitDetail>>
    try {
      result = await window.electronAPI.gitCommitDetail(folderPath, sha)
    } catch {
      return
    }
    if (!result.ok) return

    set((s) => ({ commitDetails: { ...s.commitDetails, [sha]: result.detail } }))
  }
}))

async function readLog(
  folderPath: string,
  limit: number,
  skip: number
): Promise<Awaited<ReturnType<typeof window.electronAPI.gitLog>>> {
  try {
    return await window.electronAPI.gitLog(folderPath, limit, skip)
  } catch {
    return { ok: false, error: 'Failed to read history' }
  }
}
