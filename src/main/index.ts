import { app, shell, BrowserWindow, ipcMain, protocol, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers } from './ptyManager'
import { registerFolderHandlers } from './folderManager'
import { registerFileHandlers } from './fileManager'
import { registerGitHandlers } from './gitManager'
import { registerRecentProjectsHandlers } from './recentProjectsManager'
import { saveLayout, saveLayoutSync, loadLayout, ensureGitignore } from './layoutManager'
import type { LayoutSnapshot } from './layoutManager'
import { startRpcServer } from './rpcServer'
import { injectHooks, removeHooks } from './hookInjector'

// Set app name early — used by macOS menu bar
app.setName('Multiterm Studio')

// Register custom protocol for serving local files (images in markdown preview, etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { supportFetchAPI: true, bypassCSP: true } }
])

// Cache the most-recent save data so before-quit can do a synchronous flush
let lastSaveData: { folderPath: string; layout: LayoutSnapshot } | null = null
let rpcCleanup: (() => void) | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#1a1a1a',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Register PTY IPC handlers
  registerPtyHandlers(win)
  // Register folder IPC handlers for project context panel (Phase 03)
  registerFolderHandlers(win)
  // Register file read/write IPC handlers for editor tiles
  registerFileHandlers(win)
  // Register git IPC handlers for branch switching
  registerGitHandlers()
  // Register recent projects IPC handlers
  registerRecentProjectsHandlers()

  // Start RPC server for Claude Code hook notifications
  startRpcServer(win).then(({ cleanup }) => {
    rpcCleanup = cleanup
  })

  // Hooks IPC handlers
  ipcMain.handle('hooks:inject', async (_event, folderPath: string) => {
    await injectHooks(folderPath)
  })
  ipcMain.handle('hooks:remove', async (_event, folderPath: string) => {
    await removeHooks(folderPath)
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Layout persistence IPC handlers
ipcMain.handle('layout:save', async (_event, folderPath: string, layout: LayoutSnapshot) => {
  lastSaveData = { folderPath, layout }
  await saveLayout(folderPath, layout)
  await ensureGitignore(folderPath)
})

ipcMain.handle('layout:load', async (_event, folderPath: string) => {
  return loadLayout(folderPath)
})

// Synchronous save on quit to capture any last-second changes
app.on('before-quit', () => {
  if (lastSaveData !== null) {
    saveLayoutSync(lastSaveData.folderPath, lastSaveData.layout)
  }
  if (rpcCleanup) {
    rpcCleanup()
    rpcCleanup = null
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Handle local-resource:// protocol — serves local files for markdown preview images
  protocol.handle('local-resource', (req) => {
    const filePath = decodeURIComponent(new URL(req.url).pathname)
    return net.fetch(`file://${filePath}`)
  })

  electronApp.setAppUserModelId('com.multiterm.studio')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
