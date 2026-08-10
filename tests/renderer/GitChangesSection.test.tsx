import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import type { GitStatus } from '../../src/shared/git'

const settingsGet = vi.fn().mockResolvedValue(null)
const settingsSet = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { settingsGet, settingsSet },
  writable: true
})

import { GitChangesSection } from '@renderer/components/GitChangesSection'
import { useGitStore } from '@renderer/store/gitStore'
import { useProjectStore } from '@renderer/store/projectStore'

/**
 * The view is pure: useGitStatusSync owns the reads, so these tests seed the
 * store directly and never touch the bridge.
 */
function seed(files: GitStatus['files'], folderPath = '/proj'): void {
  useGitStore.setState({
    isRepo: true,
    status: { branch: 'main', ahead: 0, behind: 0, detached: false, files },
    statusPath: folderPath,
    statusError: null
  })
}

describe('GitChangesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsGet.mockResolvedValue(null)
    useGitStore.getState().reset()
    useProjectStore.setState({ pendingFileOpen: null, pendingDiffOpen: null })
  })

  it('says so when the folder is not a repository', () => {
    render(<GitChangesSection folderPath="/proj" />)

    expect(screen.getByText('Not a git repository')).toBeTruthy()
  })

  it('ignores a status belonging to a different folder', () => {
    seed([{ path: 'a.ts', index: 'unmodified', worktree: 'modified' }], '/other')

    render(<GitChangesSection folderPath="/proj" />)

    expect(screen.queryByText('a.ts')).toBeNull()
    expect(screen.getByText('Working tree clean')).toBeTruthy()
  })

  it('lists changed files under their group', () => {
    seed([
      { path: 'src/staged.ts', index: 'added', worktree: 'unmodified' },
      { path: 'src/edited.ts', index: 'unmodified', worktree: 'modified' },
      { path: 'notes.md', index: 'unmodified', worktree: 'untracked' }
    ])

    render(<GitChangesSection folderPath="/proj" />)

    expect(screen.getByText('Staged')).toBeTruthy()
    expect(screen.getByText('Unstaged')).toBeTruthy()
    expect(screen.getByText('Untracked')).toBeTruthy()
    // The pane is the only thing called Changes; the group under it is not.
    expect(screen.getAllByText('Changes')).toHaveLength(1)
    expect(screen.getByText('staged.ts')).toBeTruthy()
    // Both src/ rows show their directory next to the name.
    expect(screen.getAllByText('src')).toHaveLength(2)
  })

  it('reports a clean working tree', () => {
    seed([])

    render(<GitChangesSection folderPath="/proj" />)

    expect(screen.getByText('Working tree clean')).toBeTruthy()
  })

  it('surfaces a status failure', () => {
    useGitStore.setState({ isRepo: true, statusPath: '/proj', statusError: 'index.lock exists' })

    render(<GitChangesSection folderPath="/proj" />)

    expect(screen.getByText('index.lock exists')).toBeTruthy()
  })

  it('opens a working-tree diff for a modified file', () => {
    seed([{ path: 'src/edited.ts', index: 'unmodified', worktree: 'modified' }])

    render(<GitChangesSection folderPath="/proj" />)
    fireEvent.click(screen.getByText('edited.ts'))

    expect(useProjectStore.getState().pendingDiffOpen).toEqual({
      filePath: '/proj/src/edited.ts',
      staged: false
    })
  })

  it('opens a staged diff for a file clicked in the staged group', () => {
    seed([{ path: 'src/added.ts', index: 'added', worktree: 'unmodified' }])

    render(<GitChangesSection folderPath="/proj" />)
    fireEvent.click(screen.getByText('added.ts'))

    expect(useProjectStore.getState().pendingDiffOpen?.staged).toBe(true)
  })

  it('opens an untracked file in the editor, since it has nothing to diff against', () => {
    seed([{ path: 'notes.md', index: 'unmodified', worktree: 'untracked' }])

    render(<GitChangesSection folderPath="/proj" />)
    fireEvent.click(screen.getByText('notes.md'))

    expect(useProjectStore.getState().pendingFileOpen).toBe('/proj/notes.md')
    expect(useProjectStore.getState().pendingDiffOpen).toBeNull()
  })

  it('collapses a single group without hiding the others', () => {
    seed([
      { path: 'src/staged.ts', index: 'added', worktree: 'unmodified' },
      { path: 'src/edited.ts', index: 'unmodified', worktree: 'modified' }
    ])

    render(<GitChangesSection folderPath="/proj" />)
    fireEvent.click(screen.getByText('Staged'))

    expect(screen.queryByText('staged.ts')).toBeNull()
    expect(screen.getByText('edited.ts')).toBeTruthy()
  })

  it('reports an untracked folder without offering a file to open', () => {
    // git collapses a wholly untracked folder into one entry; there is no file
    // behind it, so the row must not look clickable.
    seed([{ path: 'src/renderer/src/hooks/', index: 'unmodified', worktree: 'untracked' }])

    render(<GitChangesSection folderPath="/proj" />)

    expect(screen.getByText('hooks/')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /hooks/ })).toBeNull()
  })

  describe('panes', () => {
    it('gives changes and graph a header each', () => {
      seed([])

      render(<GitChangesSection folderPath="/proj" />)

      expect(screen.getByText('Graph')).toBeTruthy()
      expect(screen.getAllByText('Changes')).toHaveLength(1)
    })

    it('lets the open pane take the space when the other is collapsed', () => {
      seed([{ path: 'a.ts', index: 'unmodified', worktree: 'modified' }])

      const { container } = render(<GitChangesSection folderPath="/proj" />)
      const [changesPane, graphPane] = container.querySelectorAll('.sc-pane')
      expect(graphPane.className).toContain('sc-pane--grow')

      // Collapsing the graph must hand its space over, not leave its header
      // stranded above an empty block.
      fireEvent.click(screen.getByText('Graph'))

      expect(changesPane.className).toContain('sc-pane--grow')
      expect(graphPane.className).not.toContain('sc-pane--grow')
    })

    it('collapses a pane to its header', () => {
      seed([{ path: 'a.ts', index: 'unmodified', worktree: 'modified' }])

      render(<GitChangesSection folderPath="/proj" />)
      expect(screen.getByText('a.ts')).toBeTruthy()

      fireEvent.click(screen.getByText('Changes'))

      expect(screen.queryByText('a.ts')).toBeNull()
      expect(settingsSet).toHaveBeenCalledWith('ui.sourceControl.changesCollapsed', true)
    })

    it('drops the divider when one pane is collapsed, leaving nothing to divide', () => {
      seed([])

      const { container } = render(<GitChangesSection folderPath="/proj" />)
      expect(container.querySelector('.sc-splitter')).toBeTruthy()

      fireEvent.click(screen.getByText('Graph'))

      expect(container.querySelector('.sc-splitter')).toBeNull()
    })

    it('resizes the changes pane by dragging and remembers the height', () => {
      seed([])

      const { container } = render(<GitChangesSection folderPath="/proj" />)
      const pane = container.querySelector('.sc-pane') as HTMLElement
      const splitter = container.querySelector('.sc-splitter')!

      fireEvent.mouseDown(splitter, { clientY: 300 })
      fireEvent.mouseMove(document, { clientY: 360 })
      fireEvent.mouseUp(document, { clientY: 360 })

      expect(pane.style.flex).toBe('0 0 320px')
      expect(settingsSet).toHaveBeenCalledWith('ui.sourceControl.changesHeight', 320)
    })

    it('refuses to drag a pane smaller than its header', () => {
      seed([])

      const { container } = render(<GitChangesSection folderPath="/proj" />)
      const pane = container.querySelector('.sc-pane') as HTMLElement
      const splitter = container.querySelector('.sc-splitter')!

      fireEvent.mouseDown(splitter, { clientY: 300 })
      fireEvent.mouseMove(document, { clientY: -500 })
      fireEvent.mouseUp(document, { clientY: -500 })

      expect(pane.style.flex).toBe('0 0 90px')
    })

    it('restores the remembered layout', async () => {
      settingsGet.mockImplementation((key: string) =>
        Promise.resolve(key === 'ui.sourceControl.changesHeight' ? 410 : false)
      )
      seed([])

      const { container } = render(<GitChangesSection folderPath="/proj" />)
      await act(async () => {
        await Promise.resolve()
      })

      expect((container.querySelector('.sc-pane') as HTMLElement).style.flex).toBe('0 0 410px')
    })
  })
})
