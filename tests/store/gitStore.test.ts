import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useGitStore, STATUS_DEBOUNCE_MS, GIT_REFRESH_DEBOUNCE_MS } from '@renderer/store/gitStore'
import { GIT_LOG_PAGE_SIZE } from '../../src/shared/git'
import type { GitCommit, GitStatus, GitStatusResult } from '../../src/shared/git'

const gitStatus = vi.fn<(folderPath: string) => Promise<GitStatusResult>>()
const gitLog = vi.fn()
const gitCommitDetail = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { gitStatus, gitLog, gitCommitDetail },
  writable: true
})

function commits(count: number, offset = 0): GitCommit[] {
  return Array.from({ length: count }, (_, i) => ({
    sha: `sha${offset + i}`,
    shortSha: `sha${offset + i}`,
    authorName: 'Test',
    authorEmail: 't@example.com',
    timestamp: 0,
    parents: [],
    refs: [],
    subject: `commit ${offset + i}`,
    body: ''
  }))
}

function status(overrides: Partial<GitStatus> = {}): GitStatus {
  return { branch: 'main', ahead: 0, behind: 0, detached: false, files: [], ...overrides }
}

/** A promise plus the handle to settle it, so a reply can be held open. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('gitStore — status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    gitStatus.mockResolvedValue({ ok: true, status: status() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores the status and the folder it belongs to', async () => {
    gitStatus.mockResolvedValue({
      ok: true,
      status: status({
        branch: 'feature',
        files: [{ path: 'a.ts', index: 'added', worktree: 'unmodified' }]
      })
    })

    await useGitStore.getState().refreshStatus('/proj')

    expect(gitStatus).toHaveBeenCalledWith('/proj')
    expect(useGitStore.getState().status?.branch).toBe('feature')
    expect(useGitStore.getState().statusPath).toBe('/proj')
    expect(useGitStore.getState().statusError).toBeNull()
  })

  it('keeps a failure as a message instead of throwing', async () => {
    gitStatus.mockResolvedValue({ ok: false, error: 'not a repository' })

    await useGitStore.getState().refreshStatus('/proj')

    expect(useGitStore.getState().status).toBeNull()
    expect(useGitStore.getState().statusError).toBe('not a repository')
  })

  it('survives a rejected bridge call', async () => {
    gitStatus.mockRejectedValue(new Error('bridge is gone'))

    await useGitStore.getState().refreshStatus('/proj')

    expect(useGitStore.getState().statusError).toBeTruthy()
    expect(useGitStore.getState().statusLoading).toBe(false)
  })

  it('shows loading only on the first read of a folder', async () => {
    const first = deferred<GitStatusResult>()
    gitStatus.mockReturnValueOnce(first.promise)

    const pending = useGitStore.getState().refreshStatus('/proj')
    expect(useGitStore.getState().statusLoading).toBe(true)
    first.resolve({ ok: true, status: status() })
    await pending

    // A watcher-driven re-read of the same folder must not flicker the section.
    const second = deferred<GitStatusResult>()
    gitStatus.mockReturnValueOnce(second.promise)
    const again = useGitStore.getState().refreshStatus('/proj')
    expect(useGitStore.getState().statusLoading).toBe(false)
    second.resolve({ ok: true, status: status() })
    await again
  })

  it('ignores a slow reply that a newer read has already superseded', async () => {
    const slow = deferred<GitStatusResult>()
    gitStatus.mockReturnValueOnce(slow.promise)
    const stale = useGitStore.getState().refreshStatus('/old')

    gitStatus.mockResolvedValueOnce({ ok: true, status: status({ branch: 'new-branch' }) })
    await useGitStore.getState().refreshStatus('/new')

    slow.resolve({ ok: true, status: status({ branch: 'old-branch' }) })
    await stale

    expect(useGitStore.getState().statusPath).toBe('/new')
    expect(useGitStore.getState().status?.branch).toBe('new-branch')
  })

  it('collapses a burst of scheduled refreshes into one read', async () => {
    vi.useFakeTimers()

    for (let i = 0; i < 20; i++) useGitStore.getState().scheduleStatusRefresh('/proj')
    expect(gitStatus).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(STATUS_DEBOUNCE_MS)
    expect(gitStatus).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending refresh when the status is cleared', async () => {
    vi.useFakeTimers()

    useGitStore.getState().scheduleStatusRefresh('/proj')
    useGitStore.getState().clearStatus()
    await vi.advanceTimersByTimeAsync(STATUS_DEBOUNCE_MS * 4)

    expect(gitStatus).not.toHaveBeenCalled()
  })

  it('drops the previous repository status on reset', async () => {
    await useGitStore.getState().refreshStatus('/proj')
    useGitStore.getState().reset()

    expect(useGitStore.getState().status).toBeNull()
    expect(useGitStore.getState().statusPath).toBeNull()
  })
})

describe('gitStore — history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    gitLog.mockResolvedValue({ ok: true, commits: commits(3) })
    gitCommitDetail.mockResolvedValue({
      ok: true,
      detail: { sha: 'sha0', files: [], insertions: 0, deletions: 0 }
    })
  })

  it('loads the first page', async () => {
    await useGitStore.getState().loadCommits('/proj')

    expect(gitLog).toHaveBeenCalledWith('/proj', GIT_LOG_PAGE_SIZE, 0)
    expect(useGitStore.getState().commits).toHaveLength(3)
    expect(useGitStore.getState().commitsLoading).toBe(false)
  })

  it('knows there is no more history when a page comes back short', async () => {
    await useGitStore.getState().loadCommits('/proj')

    expect(useGitStore.getState().hasMoreCommits).toBe(false)
  })

  it('offers more when a page comes back full', async () => {
    gitLog.mockResolvedValue({ ok: true, commits: commits(GIT_LOG_PAGE_SIZE) })

    await useGitStore.getState().loadCommits('/proj')

    expect(useGitStore.getState().hasMoreCommits).toBe(true)
  })

  it('appends the next page rather than replacing it', async () => {
    gitLog.mockResolvedValueOnce({ ok: true, commits: commits(GIT_LOG_PAGE_SIZE) })
    await useGitStore.getState().loadCommits('/proj')

    gitLog.mockResolvedValueOnce({ ok: true, commits: commits(2, GIT_LOG_PAGE_SIZE) })
    await useGitStore.getState().loadMoreCommits('/proj')

    expect(gitLog).toHaveBeenLastCalledWith('/proj', GIT_LOG_PAGE_SIZE, GIT_LOG_PAGE_SIZE)
    expect(useGitStore.getState().commits).toHaveLength(GIT_LOG_PAGE_SIZE + 2)
  })

  it('does not ask for more when there is none', async () => {
    await useGitStore.getState().loadCommits('/proj')
    gitLog.mockClear()

    await useGitStore.getState().loadMoreCommits('/proj')

    expect(gitLog).not.toHaveBeenCalled()
  })

  it('keeps a failure as a message', async () => {
    gitLog.mockResolvedValue({ ok: false, error: 'not a repository' })

    await useGitStore.getState().loadCommits('/proj')

    expect(useGitStore.getState().commits).toEqual([])
    expect(useGitStore.getState().commitsError).toBe('not a repository')
  })

  it('survives a rejected bridge call', async () => {
    gitLog.mockRejectedValue(new Error('bridge is gone'))

    await useGitStore.getState().loadCommits('/proj')

    expect(useGitStore.getState().commitsError).toBeTruthy()
    expect(useGitStore.getState().commitsLoading).toBe(false)
  })

  it('caches a commit detail, since a commit cannot change', async () => {
    await useGitStore.getState().loadCommitDetail('/proj', 'sha0')
    await useGitStore.getState().loadCommitDetail('/proj', 'sha0')

    expect(gitCommitDetail).toHaveBeenCalledTimes(1)
    expect(useGitStore.getState().commitDetails['sha0']).toBeTruthy()
  })

  it('drops cached details when the history is reloaded for another folder', async () => {
    await useGitStore.getState().loadCommitDetail('/proj', 'sha0')
    await useGitStore.getState().loadCommits('/other')

    expect(useGitStore.getState().commitDetails).toEqual({})
  })
})

describe('gitStore — reacting to a repository change', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    gitStatus.mockResolvedValue({ ok: true, status: status() })
    gitLog.mockResolvedValue({ ok: true, commits: commits(1) })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-reads both the working tree and the history', async () => {
    vi.useFakeTimers()

    useGitStore.getState().scheduleGitRefresh('/proj')
    await vi.advanceTimersByTimeAsync(GIT_REFRESH_DEBOUNCE_MS)

    expect(gitStatus).toHaveBeenCalledWith('/proj')
    expect(gitLog).toHaveBeenCalled()
  })

  it('collapses the burst a single commit produces into one refresh', async () => {
    vi.useFakeTimers()

    // A commit writes HEAD, the index and a ref: three events, one refresh.
    useGitStore.getState().scheduleGitRefresh('/proj')
    useGitStore.getState().scheduleGitRefresh('/proj')
    useGitStore.getState().scheduleGitRefresh('/proj')
    await vi.advanceTimersByTimeAsync(GIT_REFRESH_DEBOUNCE_MS)

    expect(gitStatus).toHaveBeenCalledTimes(1)
    expect(gitLog).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending refresh when the project is closed', async () => {
    vi.useFakeTimers()

    useGitStore.getState().scheduleGitRefresh('/proj')
    useGitStore.getState().reset()
    await vi.advanceTimersByTimeAsync(GIT_REFRESH_DEBOUNCE_MS * 4)

    expect(gitStatus).not.toHaveBeenCalled()
    expect(gitLog).not.toHaveBeenCalled()
  })
})
