import { ipcMain, BrowserWindow, shell } from 'electron'
import { readFile, writeFile, rename, mkdir } from 'fs/promises'
import { basename, dirname, join } from 'path'

let fileHandlersRegistered = false

export function registerFileHandlers(_win: BrowserWindow): void {
  if (fileHandlersRegistered) return
  fileHandlersRegistered = true
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    return readFile(filePath, 'utf-8')
  })

  ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
    await writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('file:rename', async (_event, oldPath: string, newName: string) => {
    const dir = dirname(oldPath)
    const newPath = join(dir, newName)
    await rename(oldPath, newPath)
    return newPath
  })

  ipcMain.handle('file:move', async (_event, sourcePath: string, targetFolder: string) => {
    const name = basename(sourcePath)
    const newPath = join(targetFolder, name)
    await rename(sourcePath, newPath)
    return newPath
  })

  ipcMain.handle('file:trash', async (_event, filePath: string) => {
    await shell.trashItem(filePath)
  })

  ipcMain.handle('file:create', async (_event, filePath: string, content: string = '') => {
    await writeFile(filePath, content, 'utf-8')
  })

  ipcMain.handle('folder:create', async (_event, folderPath: string) => {
    await mkdir(folderPath, { recursive: true })
  })
}
