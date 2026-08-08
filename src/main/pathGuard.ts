import { realpathSync } from 'fs'
import { basename, dirname, join, resolve, sep } from 'path'

/**
 * Containment check for paths that come from the renderer.
 *
 * `local-resource://` is reachable from any markdown a project happens to
 * contain, so without a check the renderer could read any file on the disk
 * through it. Symlinks are resolved first: a link inside the project pointing
 * at ~/.ssh must not pass.
 */
export function isPathInsideRoots(candidate: string, roots: string[]): boolean {
  if (roots.length === 0) return false

  const target = realPathOrResolved(candidate)

  for (const root of roots) {
    const resolvedRoot = realPathOrResolved(root)
    if (target === resolvedRoot) return true
    // The separator matters: "/home/user/proj-secrets" must not be treated as
    // living inside "/home/user/proj".
    if (target.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep)) {
      return true
    }
  }
  return false
}

/**
 * realpath() for existing paths; for one that does not exist, the realpath of
 * its deepest existing ancestor with the missing segments re-attached.
 *
 * Resolving only the existing prefix is both safe and necessary. Safe, because
 * a component that does not exist cannot be a symlink. Necessary, because the
 * roots are always fully resolved: comparing a bare resolve() against them
 * rejects legitimate paths wherever an ancestor is a link — on macOS every
 * path under /tmp or /var, whose real form lives under /private.
 *
 * Paths that do not exist are the normal case for a file being created, and
 * for one git still reports after it has been deleted from the working tree.
 */
function realPathOrResolved(filePath: string): string {
  const resolved = resolve(filePath)
  try {
    return realpathSync(resolved)
  } catch {
    const parent = dirname(resolved)
    // Bottomed out at the filesystem root, which has no parent to resolve.
    if (parent === resolved) return resolved
    return join(realPathOrResolved(parent), basename(resolved))
  }
}
