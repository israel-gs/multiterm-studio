/**
 * Path helpers for the renderer.
 *
 * Node's `path` module is not available here, and splitting on '/' alone
 * mis-handles the Windows paths the app claims to support (`build:win`).
 */

/** Last segment of a path, handling both '/' and '\' separators. */
export function basename(filePath: string): string {
  const trimmed = filePath.replace(/[/\\]+$/, '')
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

/**
 * Collapse the home directory to `~`, the way a shell prompt writes it.
 *
 * The home path is matched rather than assumed: the renderer cannot read
 * `os.homedir()`, so the shape `/Users/<name>` (macOS) or `/home/<name>`
 * (Linux) is what is recognised.
 */
export function shortenHome(fullPath: string): string {
  return fullPath.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}
