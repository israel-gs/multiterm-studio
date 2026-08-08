import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { GitDiffResult } from '../../src/shared/git'

const gitDiff =
  vi.fn<(cwd: string, filePath: string, staged: boolean, sha?: string) => Promise<GitDiffResult>>()

Object.defineProperty(window, 'electronAPI', {
  value: { gitDiff },
  writable: true
})

global.ResizeObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
})) as unknown as typeof ResizeObserver

// Monaco does not run in jsdom, and the point of the suite is the data flow
// around it: which side is requested, and what reaches setModel.
const setModel = vi.fn()
const getModel = vi.fn().mockReturnValue(null)
const createDiffEditor = vi.fn<(container: unknown, options: unknown) => unknown>(() => ({
  setModel,
  getModel,
  layout: vi.fn(),
  dispose: vi.fn()
}))
const createModel = vi.fn((value: string) => ({ value, dispose: vi.fn() }))

vi.mock('monaco-editor', () => ({
  editor: {
    createDiffEditor: (...args: unknown[]) => createDiffEditor(...(args as [])),
    createModel: (value: string) => createModel(value),
    defineTheme: vi.fn(),
    setTheme: vi.fn()
  },
  KeyMod: { CtrlCmd: 1 },
  KeyCode: { KeyS: 1 }
}))

import { DiffPanel } from '@renderer/components/DiffPanel'
import { usePanelStore } from '@renderer/store/panelStore'
import { useProjectStore } from '@renderer/store/projectStore'

const SESSION = 'diff-1'

function textDiff(original: string, modified: string, staged = false): GitDiffResult {
  return { ok: true, diff: { path: 'src/a.ts', original, modified, kind: 'text', staged } }
}

describe('DiffPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePanelStore.setState({ panels: {} })
    useProjectStore.setState({ fsRefreshKey: 0 })
    usePanelStore.getState().addPanel(SESSION, undefined, undefined, 'diff', '/proj/src/a.ts')
    gitDiff.mockResolvedValue(textDiff('one\n', 'one\ntwo\n'))
  })

  it('reads the working-tree side by default', async () => {
    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() =>
      expect(gitDiff).toHaveBeenCalledWith('/proj', '/proj/src/a.ts', false, undefined)
    )
  })

  it('lets Monaco own the measuring so a re-parented tile re-measures', async () => {
    // Maximizing moves the card into a portal on document.body; an observer of
    // our own does not see that move and the editor keeps the old size.
    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() => expect(createDiffEditor).toHaveBeenCalled())
    expect(createDiffEditor.mock.calls[0][1]).toMatchObject({ automaticLayout: true })
  })

  it('hands both sides to the diff editor', async () => {
    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() => expect(setModel).toHaveBeenCalled())
    expect(createModel).toHaveBeenCalledWith('one\n')
    expect(createModel).toHaveBeenCalledWith('one\ntwo\n')
  })

  it('switches to the staged comparison and re-reads', async () => {
    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('Staged'))

    await waitFor(() =>
      expect(gitDiff).toHaveBeenCalledWith('/proj', '/proj/src/a.ts', true, undefined)
    )
    expect(usePanelStore.getState().panels[SESSION].diffStaged).toBe(true)
  })

  it('opens on the staged side when the tile was created that way', async () => {
    usePanelStore.getState().setDiffStaged(SESSION, true)

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() =>
      expect(gitDiff).toHaveBeenCalledWith('/proj', '/proj/src/a.ts', true, undefined)
    )
  })

  it('compares a commit against its parent when the tile carries a sha', async () => {
    usePanelStore.getState().setDiffSha(SESSION, 'abc1234')

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() =>
      expect(gitDiff).toHaveBeenCalledWith('/proj', '/proj/src/a.ts', false, 'abc1234')
    )
  })

  it('offers no side toggle for a commit, which has only one comparison', async () => {
    usePanelStore.getState().setDiffSha(SESSION, 'abc1234')

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() => expect(screen.getByText('commit vs parent')).toBeTruthy())
    expect(screen.queryByText('Staged')).toBeNull()
    expect(screen.getByText('abc1234')).toBeTruthy()
  })

  it('does not re-read a commit when the file watcher fires', async () => {
    usePanelStore.getState().setDiffSha(SESSION, 'abc1234')

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)
    await waitFor(() => expect(gitDiff).toHaveBeenCalledTimes(1))

    // A commit's contents cannot change, so watcher churn must not refetch it.
    useProjectStore.setState({ fsRefreshKey: 7 })
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(gitDiff).toHaveBeenCalledTimes(1)
  })

  it('explains a binary file instead of rendering an empty diff', async () => {
    gitDiff.mockResolvedValue({
      ok: true,
      diff: { path: 'blob.bin', original: '', modified: '', kind: 'binary', staged: false }
    })

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/blob.bin" />)

    await waitFor(() => expect(screen.getByText(/Binary file/)).toBeTruthy())
    expect(setModel).not.toHaveBeenCalled()
  })

  it('explains a file too large to diff', async () => {
    gitDiff.mockResolvedValue({
      ok: true,
      diff: { path: 'huge.log', original: '', modified: '', kind: 'too-large', staged: false }
    })

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/huge.log" />)

    await waitFor(() => expect(screen.getByText(/too large/)).toBeTruthy())
  })

  it('surfaces a git failure', async () => {
    gitDiff.mockResolvedValue({ ok: false, error: 'bad object HEAD' })

    render(<DiffPanel sessionId={SESSION} cwd="/proj" filePath="/proj/src/a.ts" />)

    await waitFor(() => expect(screen.getByText('bad object HEAD')).toBeTruthy())
  })
})
