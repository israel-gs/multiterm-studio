/**
 * Which paths inside `.git` mean "the repository state the sidebar shows has
 * changed".
 *
 * The rest of `.git` churns constantly — loose objects, logs, FETCH_HEAD — and
 * forwarding all of it would refresh the sidebar for nothing. These few are the
 * ones a commit, a stage, a branch switch or a merge actually writes.
 */
const GIT_SIGNAL_FILES = new Set([
  'HEAD',
  'index',
  'packed-refs',
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REBASE_HEAD',
  'REVERT_HEAD'
])

/**
 * True when a repo-relative path is a git change worth reacting to.
 *
 * Lock files are excluded on purpose: git writes `index.lock` before the real
 * write and removes it after, so reacting to it would read the repository
 * exactly while it is half-updated.
 */
export function isGitSignalPath(relativePath: string): boolean {
  const parts = relativePath.split(/[/\\]/)
  const gitAt = parts.indexOf('.git')
  if (gitAt === -1) return false

  const inside = parts.slice(gitAt + 1)
  if (inside.length === 0) return false
  if (inside[inside.length - 1].endsWith('.lock')) return false

  // A ref being created or moved is a commit, a new branch, or a fetch.
  if (inside[0] === 'refs') return inside.length > 1
  return inside.length === 1 && GIT_SIGNAL_FILES.has(inside[0])
}

/** True for any path inside a `.git` directory, signal or noise. */
export function isInsideGitDir(relativePath: string): boolean {
  return relativePath.split(/[/\\]/).includes('.git')
}
