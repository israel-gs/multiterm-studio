import type { GitFileState, GitFileStatus } from '../../../shared/git'

/**
 * The four buckets the sidebar renders, in the order it renders them.
 *
 * A file can land in two of them at once: staging a change and then editing
 * the file again leaves work both in the index and on disk, and hiding either
 * half would misreport what the next commit contains.
 */
export interface GitStatusGroups {
  conflicts: GitFileStatus[]
  staged: GitFileStatus[]
  changes: GitFileStatus[]
  untracked: GitFileStatus[]
}

export function groupStatusFiles(files: GitFileStatus[]): GitStatusGroups {
  const groups: GitStatusGroups = { conflicts: [], staged: [], changes: [], untracked: [] }

  for (const file of files) {
    if (file.index === 'unmerged' || file.worktree === 'unmerged') {
      groups.conflicts.push(file)
      continue
    }
    if (file.worktree === 'untracked') {
      groups.untracked.push(file)
      continue
    }
    if (file.index !== 'unmodified') groups.staged.push(file)
    if (file.worktree !== 'unmodified') groups.changes.push(file)
  }

  return groups
}

const STATE_LETTERS: Record<GitFileState, string> = {
  unmodified: '',
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  unmerged: '!'
}

/**
 * The single letter shown next to a path, taken from the side of the file the
 * group is about: the staged list reports what the index holds, the changes
 * list what the working tree holds.
 */
export function statusLetter(file: GitFileStatus, side: 'index' | 'worktree'): string {
  return STATE_LETTERS[file[side]]
}

/** Maps a state onto the palette so M/A/D read the same as everywhere else. */
export function statusColorVar(state: GitFileState): string {
  switch (state) {
    case 'added':
    case 'untracked':
      return 'var(--color-green)'
    case 'deleted':
      return 'var(--color-red)'
    case 'unmerged':
      return 'var(--color-yellow)'
    case 'renamed':
    case 'copied':
      return 'var(--color-purple)'
    default:
      return 'var(--color-blue)'
  }
}

/**
 * True for the directory form git uses when it collapses a wholly untracked
 * folder into one entry, "src/hooks/".
 */
export function isDirectoryEntry(path: string): boolean {
  return path.endsWith('/')
}

/**
 * Splits "src/main/git.ts" into the name shown in full and the dimmed prefix.
 *
 * A trailing slash marks a directory rather than an empty name, so it stays on
 * the name — "src/hooks/" reads as `hooks/` under `src`, not as a blank row.
 */
export function splitDisplayPath(path: string): { name: string; dir: string } {
  const isDir = isDirectoryEntry(path)
  const bare = isDir ? path.slice(0, -1) : path
  const slash = bare.lastIndexOf('/')
  const name = slash === -1 ? bare : bare.slice(slash + 1)
  return {
    name: isDir ? `${name}/` : name,
    dir: slash === -1 ? '' : bare.slice(0, slash)
  }
}
