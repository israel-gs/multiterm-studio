import { realpathSync } from 'fs'
import { resolve, sep } from 'path'

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
 * realpath() for existing paths, plain resolve() otherwise.
 *
 * A path that does not exist yet cannot be a symlink escape, and resolve()
 * still collapses any `..` segments.
 */
function realPathOrResolved(filePath: string): string {
  const resolved = resolve(filePath)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}
