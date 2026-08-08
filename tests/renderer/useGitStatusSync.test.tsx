import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import type { GitStatusResult } from '../../src/shared/git'

const gitStatus = vi.fn<(folderPath: string) => Promise<GitStatusResult>>()

Object.defineProperty(window, 'electronAPI', {
  value: { gitStatus },
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
    useProjectStore.setState({ fsRefreshKey: 0 })
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
})
