import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { GitStatus } from '../../src/shared/git'

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

    expect(screen.getByText('Staged changes')).toBeTruthy()
    expect(screen.getByText('Changes')).toBeTruthy()
    expect(screen.getByText('Untracked')).toBeTruthy()
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
    fireEvent.click(screen.getByText('Staged changes'))

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
})
