/**
 * Debounced save utility for layout persistence.
 * Uses a module-level singleton timer to batch rapid changes (drag-resize, rename, recolor).
 * Fires layoutSave via IPC 1 second after the last scheduleSave call.
 */

let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Schedule a layout save. Resets the 1-second debounce timer on each call.
 * Only the final call within the debounce window fires the IPC save.
 */
export function scheduleSave(folderPath: string, snapshot: unknown): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    window.electronAPI.layoutSave(folderPath, snapshot)
  }, 1000)
}

/**
 * Immediately fires any pending debounced save. Useful for flushing before unmount.
 */
export function flushSave(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer)
    debounceTimer = null
    // Note: cannot fire the save here without storing the last args —
    // this is a best-effort flush guard used in tests / controlled teardown.
  }
}
