import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readdir } from 'fs/promises'
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

  ipcMain.handle('folder:readdir', async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  })
}
