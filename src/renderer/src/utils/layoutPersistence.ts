/**
 * Debounced save utility for layout persistence.
 * Uses a module-level singleton timer to batch rapid changes (drag-resize, rename, recolor).
 * Fires layoutSave via IPC 1 second after the last scheduleSave call.
 *
 * Supports two modes:
 * - folder: saves to .multiterm/layout.json (existing per-project behavior)
 * - workspace: saves into the .multiterm-workspace file
 */

export type SaveTarget =
  | { mode: 'folder'; folderPath: string }
  | { mode: 'workspace'; wsFilePath: string; expandedDirs: Record<string, string[]> }

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pending: { target: SaveTarget; snapshot: unknown } | null = null

function writeNow(target: SaveTarget, snapshot: unknown): Promise<void> {
  if (target.mode === 'workspace') {
    return window.electronAPI.layoutSaveWorkspace(target.wsFilePath, snapshot, target.expandedDirs)
  }
  return window.electronAPI.layoutSave(target.folderPath, snapshot)
}

/**
 * Schedule a layout save. Resets the 1-second debounce timer on each call.
 * Only the final call within the debounce window fires the IPC save.
 */
export function scheduleSave(target: SaveTarget | string, snapshot: unknown): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }

  // Backwards compat: accept plain folderPath string
  const resolved: SaveTarget =
    typeof target === 'string' ? { mode: 'folder', folderPath: target } : target

  pending = { target: resolved, snapshot }

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const job = pending
    pending = null
    if (job) void writeNow(job.target, job.snapshot)
  }, 1000)
}

/**
 * Immediately writes any pending debounced save instead of waiting out the
 * timer. Call this before tearing down a project — otherwise the last second of
 * layout changes is silently dropped.
 */
export function flushSave(): Promise<void> {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  const job = pending
  pending = null
  if (!job) return Promise.resolve()
  return writeNow(job.target, job.snapshot)
}
