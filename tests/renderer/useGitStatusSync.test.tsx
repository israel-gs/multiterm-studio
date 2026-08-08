import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { GitStatusResult } from '../../src/shared/git'

const gitStatus = vi.fn<(folderPath: string) => Promise<GitStatusResult>>()
const gitLog = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { gitStatus, gitLog },
  writable: true
})

import { useGitStatusSync } from '@renderer/hooks/useGitStatusSync'
import { useGitStore } from '@renderer/store/gitStore'
import { useProjectStore } from '@renderer/store/projectStore'

function Probe({ folderPath }: { folderPath: string }): null {
  useGitStatusSync(folderPath)
  return null
}

describe('useGitStatusSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    useProjectStore.setState({ fsRefreshKey: 0, gitRefreshKey: 0 })
    gitLog.mockResolvedValue({ ok: true, commits: [] })
    gitStatus.mockResolvedValue({
      ok: true,
      status: { branch: 'main', ahead: 0, behind: 0, detached: false, files: [] }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not touch git outside a repository', () => {
    render(<Probe folderPath="/proj" />)

    expect(gitStatus).not.toHaveBeenCalled()
  })

  it('reads the status immediately once the folder is known to be a repo', async () => {
    useGitStore.getState().setIsRepo(true)

    render(<Probe folderPath="/proj" />)

    await vi.waitFor(() => expect(gitStatus).toHaveBeenCalledWith('/proj'))
  })

  it('re-reads, debounced, when the file watcher fires', async () => {
    vi.useFakeTimers()
    useGitStore.getState().setIsRepo(true)

    render(<Probe folderPath="/proj" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(gitStatus).toHaveBeenCalledTimes(1)

    // A burst of watcher events must collapse into a single extra read.
    await act(async () => {
      useProjectStore.getState().bumpFsRefresh()
      useProjectStore.getState().bumpFsRefresh()
      useProjectStore.getState().bumpFsRefresh()
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(gitStatus).toHaveBeenCalledTimes(2)
  })

  it('drops the status when the folder turns out not to be a repo', async () => {
    useGitStore.getState().setIsRepo(true)
    const { rerender } = render(<Probe folderPath="/proj" />)
    await vi.waitFor(() => expect(useGitStore.getState().statusPath).toBe('/proj'))

    await act(async () => {
      useGitStore.getState().setIsRepo(false)
      rerender(<Probe folderPath="/proj" />)
    })

    expect(useGitStore.getState().status).toBeNull()
    expect(useGitStore.getState().statusPath).toBeNull()
  })

  it('reads the history once when the folder is opened', async () => {
    useGitStore.getState().setIsRepo(true)

    render(<Probe folderPath="/proj" />)

    await vi.waitFor(() => expect(gitLog).toHaveBeenCalledTimes(1))
  })

  it('re-reads status and history when the repository changes', async () => {
    vi.useFakeTimers()
    useGitStore.getState().setIsRepo(true)

    render(<Probe folderPath="/proj" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    gitStatus.mockClear()
    gitLog.mockClear()

    // Committing touches nothing but .git, which arrives on its own channel.
    await act(async () => {
      useProjectStore.getState().bumpGitRefresh()
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(gitStatus).toHaveBeenCalledTimes(1)
    expect(gitLog).toHaveBeenCalledTimes(1)
  })

  it('does not re-read the history for an ordinary file change', async () => {
    vi.useFakeTimers()
    useGitStore.getState().setIsRepo(true)

    render(<Probe folderPath="/proj" />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    gitLog.mockClear()

    await act(async () => {
      useProjectStore.getState().bumpFsRefresh()
      await vi.advanceTimersByTimeAsync(500)
    })

    expect(gitLog).not.toHaveBeenCalled()
  })
})
