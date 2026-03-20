import { ipcMain, BrowserWindow } from 'electron'
import { readFile, writeFile } from 'fs/promises'

export function registerFileHandlers(_win: BrowserWindow): void {
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    return readFile(filePath, 'utf-8')
  })

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })
}
