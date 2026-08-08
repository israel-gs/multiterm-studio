import { create } from 'zustand'
import type { GitStatus } from '../../../shared/git'

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
}

/**
 * Guards against an out-of-order reply overwriting a newer one. Reads are
 * fired by a file watcher and by the user switching folders, so a slow status
 * on a big repo can easily land after a fast one for a different folder.
 */
let statusRequestId = 0
let statusTimer: ReturnType<typeof setTimeout> | null = null

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
      statusError: null
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
    set({ status: null, statusPath: null, statusLoading: false, statusError: null })
  }
}))
