import { watch, type FSWatcher } from 'fs'
import { join, relative } from 'path'
import { BrowserWindow } from 'electron'

let watcher: FSWatcher | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
const pendingChanges = new Map<string, 'change' | 'rename'>()

export function startFileWatcher(folderPath: string, win: BrowserWindow): void {
  stopFileWatcher()

  try {
    watcher = watch(folderPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return
      // Ignore hidden dirs, node_modules, .git
      if (
        filename.startsWith('.') ||
        filename.includes('node_modules') ||
        filename.includes('.git/')
      ) {
        return
      }

      pendingChanges.set(filename, eventType as 'change' | 'rename')

      // Debounce: batch changes over 300ms
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const changes = Array.from(pendingChanges.entries()).map(([path, type]) => ({
          path: join(folderPath, path),
          relativePath: path,
          type
        }))
        pendingChanges.clear()

        if (changes.length > 0 && !win.isDestroyed()) {
          win.webContents.send('fs:changed', changes)
        }
      }, 300)
    })
  } catch {
    // folder might not exist yet
  }
}

export function stopFileWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingChanges.clear()
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
