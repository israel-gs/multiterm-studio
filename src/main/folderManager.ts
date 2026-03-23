import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export function registerFolderHandlers(win: BrowserWindow): void {
  ipcMain.handle('folder:open', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('file:open-dialog', async (_event, filters?: { name: string; extensions: string[] }[]) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: filters ?? []
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('folder:readdir', async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
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
