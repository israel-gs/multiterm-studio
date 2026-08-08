import { describe, it, expect } from 'vitest'
import {
  groupStatusFiles,
  isDirectoryEntry,
  splitDisplayPath,
  statusColorVar,
  statusLetter
} from '@renderer/utils/gitStatus'
import type { GitFileStatus } from '../../src/shared/git'

function file(partial: Partial<GitFileStatus> & { path: string }): GitFileStatus {
  return { index: 'unmodified', worktree: 'unmodified', ...partial }
}

describe('groupStatusFiles', () => {
  it('separates staged from working-tree changes', () => {
    const groups = groupStatusFiles([
      file({ path: 'a.ts', index: 'added' }),
      file({ path: 'b.ts', worktree: 'modified' })
    ])

    expect(groups.staged.map((f) => f.path)).toEqual(['a.ts'])
    expect(groups.changes.map((f) => f.path)).toEqual(['b.ts'])
  })

  it('lists a staged-and-modified file in both groups', () => {
    // Staging a change and editing again leaves work on both sides; showing it
    // once would misreport what the next commit contains.
    const groups = groupStatusFiles([
      file({ path: 'a.ts', index: 'modified', worktree: 'modified' })
    ])

    expect(groups.staged).toHaveLength(1)
    expect(groups.changes).toHaveLength(1)
  })

  it('puts untracked files in their own group and nowhere else', () => {
    const groups = groupStatusFiles([file({ path: 'new.ts', worktree: 'untracked' })])

    expect(groups.untracked.map((f) => f.path)).toEqual(['new.ts'])
    expect(groups.changes).toEqual([])
  })

  it('pulls a conflict out of every other group', () => {
    const groups = groupStatusFiles([
      file({ path: 'clash.ts', index: 'unmerged', worktree: 'unmerged' })
    ])

    expect(groups.conflicts.map((f) => f.path)).toEqual(['clash.ts'])
    expect(groups.staged).toEqual([])
    expect(groups.changes).toEqual([])
  })

  it('drops a file that is clean on both sides', () => {
    const groups = groupStatusFiles([file({ path: 'clean.ts' })])

    expect(groups).toEqual({ conflicts: [], staged: [], changes: [], untracked: [] })
  })
})

describe('statusLetter', () => {
  it('reports the side the group is about', () => {
    const staged = file({ path: 'a.ts', index: 'added', worktree: 'deleted' })

    expect(statusLetter(staged, 'index')).toBe('A')
    expect(statusLetter(staged, 'worktree')).toBe('D')
  })
})

describe('statusColorVar', () => {
  it('greens additions and reds deletions', () => {
    expect(statusColorVar('added')).toBe('var(--color-green)')
    expect(statusColorVar('untracked')).toBe('var(--color-green)')
    expect(statusColorVar('deleted')).toBe('var(--color-red)')
  })
})

describe('isDirectoryEntry', () => {
  it('recognises the collapsed-folder form git reports', () => {
    expect(isDirectoryEntry('src/hooks/')).toBe(true)
    expect(isDirectoryEntry('src/hooks/index.ts')).toBe(false)
  })
})

describe('splitDisplayPath', () => {
  it('splits a nested path into name and directory', () => {
    expect(splitDisplayPath('src/main/git.ts')).toEqual({ name: 'git.ts', dir: 'src/main' })
  })

  it('leaves a root-level file without a directory', () => {
    expect(splitDisplayPath('README.md')).toEqual({ name: 'README.md', dir: '' })
  })

  it('keeps the trailing slash on the name of a collapsed folder', () => {
    // Splitting on the last slash would leave an empty name and render a blank
    // row where git reported a wholly untracked folder.
    expect(splitDisplayPath('src/renderer/src/hooks/')).toEqual({
      name: 'hooks/',
      dir: 'src/renderer/src'
    })
  })

  it('handles a top-level folder with no parent to dim', () => {
    expect(splitDisplayPath('scripts/')).toEqual({ name: 'scripts/', dir: '' })
  })
})
