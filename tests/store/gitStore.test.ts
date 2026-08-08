import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useGitStore, STATUS_DEBOUNCE_MS } from '@renderer/store/gitStore'
import type { GitStatus, GitStatusResult } from '../../src/shared/git'

const gitStatus = vi.fn<(folderPath: string) => Promise<GitStatusResult>>()

Object.defineProperty(window, 'electronAPI', {
  value: { gitStatus },
  writable: true
})

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
