/**
 * Types shared by the git handlers in the main process and their consumers in
 * the renderer. They live here so the two sides cannot drift apart.
 */

/** Single-letter state as git reports it in `status --porcelain=v2`. */
export type GitFileState =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'unmerged'

/**
 * One path in the working tree.
 *
 * `index` and `worktree` are independent: a file can be staged as modified and
 * modified again on disk, which is why the sidebar needs both to decide
 * whether the path belongs under "Staged", "Changes", or both.
 */
export interface GitFileStatus {
  /** Repo-relative, forward-slashed, never quoted. */
  path: string
  /** Where a rename or copy came from. */
  origPath?: string
  index: GitFileState
  worktree: GitFileState
}

export interface GitStatus {
  branch: string
  /** Absent on a detached HEAD or a branch with no upstream. */
  upstream?: string
  ahead: number
  behind: number
  detached: boolean
  files: GitFileStatus[]
}

/** Why a diff has no text to show. */
export type GitDiffKind = 'text' | 'binary' | 'too-large'

/**
 * The two sides of a file diff, ready to hand to a Monaco diff editor.
 * Both are empty strings when `kind` is not `text`.
 */
export interface GitFileDiff {
  path: string
  original: string
  modified: string
  kind: GitDiffKind
  /** True when the comparison is index-vs-HEAD rather than worktree-vs-index. */
  staged: boolean
}

/** Largest blob either side of a diff may have before we refuse to load it. */
export const GIT_MAX_DIFF_BYTES = 5 * 1024 * 1024

/**
 * Both reads are polled — by the file watcher for status, by the user clicking
 * around for diffs — so they report failure as a value instead of throwing
 * across IPC, where the renderer would only see a mangled Error.
 */
export type GitStatusResult = { ok: true; status: GitStatus } | { ok: false; error: string }

export type GitDiffResult = { ok: true; diff: GitFileDiff } | { ok: false; error: string }
