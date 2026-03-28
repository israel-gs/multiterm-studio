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

/**
 * Schedule a layout save. Resets the 1-second debounce timer on each call.
 * Only the final call within the debounce window fires the IPC save.
 */
export function scheduleSave(target: SaveTarget | string, snapshot: unknown): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }

  // Backwards compat: accept plain folderPath string
  const resolved: SaveTarget = typeof target === 'string'
    ? { mode: 'folder', folderPath: target }
    : target

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (resolved.mode === 'workspace') {
      window.electronAPI.layoutSaveWorkspace(resolved.wsFilePath, snapshot, resolved.expandedDirs)
    } else {
      window.electronAPI.layoutSave(resolved.folderPath, snapshot)
    }
  }, 1000)
}

/**
 * Immediately fires any pending debounced save. Useful for flushing before unmount.
 */
export function flushSave(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}
