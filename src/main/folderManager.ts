import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readdir, stat } from 'fs/promises'
import type { Dirent } from 'fs'
import { join } from 'path'

let currentWin: BrowserWindow | null = null
let folderHandlersRegistered = false

export function registerFolderHandlers(win: BrowserWindow): void {
  currentWin = win

  if (folderHandlersRegistered) return
  folderHandlersRegistered = true

  ipcMain.handle('folder:open', async () => {
    if (!currentWin) return null
    const result = await dialog.showOpenDialog(currentWin, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle(
    'file:open-dialog',
    async (_event, filters?: { name: string; extensions: string[] }[]) => {
      if (!currentWin) return null
      const result = await dialog.showOpenDialog(currentWin, {
        properties: ['openFile'],
        filters: filters ?? []
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )

  ipcMain.handle('folder:readdir', async (_event, dirPath: string) => {
    // A workspace can legitimately reference a folder that is not currently
    // reachable (unmounted volume, renamed directory). Report it as empty
    // rather than rejecting and breaking the whole tree.
    let entries: Dirent[]
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return []
    }
    const filtered = entries.filter((e) => e.name !== 'node_modules')

    const enriched = await Promise.all(
      filtered.map(async (e) => {
        const fullPath = join(dirPath, e.name)
        const isDir = e.isDirectory()
        try {
          const s = await stat(fullPath)
          const result: {
            name: string
            isDir: boolean
            itemCount?: number
            modifiedAt?: number
          } = { name: e.name, isDir, modifiedAt: s.mtimeMs }

          if (isDir) {
            const children = await readdir(fullPath)
            result.itemCount = children.filter((c) => c !== 'node_modules').length
          }
          return result
        } catch {
          return { name: e.name, isDir }
        }
      })
    )

    return enriched.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  })
}
