import { app, shell, BrowserWindow, ipcMain, Menu, globalShortcut, protocol, net } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers, cleanupOrphanSessions, setTmuxMouseMode } from './ptyManager'
import { initSettings, getSetting, setSetting } from './settingsManager'
import { registerFolderHandlers } from './folderManager'
import { registerFileHandlers } from './fileManager'
import { registerGitHandlers } from './gitManager'
import { registerRecentProjectsHandlers } from './recentProjectsManager'
import { saveLayout, saveLayoutSync, loadLayout, ensureGitignore } from './layoutManager'
import type { LayoutSnapshot } from './layoutManager'
import { startRpcServer } from './rpcServer'
import { injectHooks, removeHooks, injectOpenCodeHooks, removeOpenCodeHooks, injectCodexHooks, removeCodexHooks, injectGeminiHooks, removeGeminiHooks } from './hookInjector'
import { startFileWatcher, startMultiFileWatcher, stopFileWatcher } from './fileWatcher'
import { installCli } from './cliInstaller'
import { loadWorkspaceConfig, saveWorkspaceConfig } from './workspaceConfig'
import { loadWorkspaceFile, saveWorkspaceFile } from './workspaceFileManager'
import type { MultiTermWorkspace } from './workspaceFileManager'
import { setupUpdateIPC, updateManager } from './updater'

// Set app name early — used by macOS menu bar
app.setName('Multiterm Studio')

// Register custom protocol for serving local files (images in markdown preview, etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { supportFetchAPI: true, bypassCSP: true } }
])

// Cache the most-recent save data so before-quit can do a synchronous flush
let lastSaveData:
  | { mode?: 'folder'; folderPath: string; layout: LayoutSnapshot }
  | { mode: 'workspace'; wsFilePath: string; layout: LayoutSnapshot; expandedDirs: Record<string, string[]>; folders: Array<{ path: string }> }
  | null = null
let rpcCleanup: (() => void) | null = null
let mainWindow: BrowserWindow | null = null
let inlineHandlersRegistered = false

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

  // Register auto-update IPC handlers
  setupUpdateIPC()

  // Update module-level window reference (used by inline IPC handlers)
  mainWindow = win

  // Start RPC server for Claude Code hook notifications (only once per process)
  if (!rpcCleanup) {
    startRpcServer(win).then(({ cleanup }) => {
      rpcCleanup = cleanup
    })
  }

  // Register inline IPC handlers only once (they use mainWindow which is updated above)
  if (!inlineHandlersRegistered) {
    inlineHandlersRegistered = true

    // Pane creation acknowledgment pass-through (renderer → RPC server)
    ipcMain.on('pane:created', (_event, sessionId: string) => {
      // Emit a targeted event that rpcServer's pane.split handler listens for
      ipcMain.emit(`pane:created:${sessionId}`)
    })

    // Native context menu
    ipcMain.handle(
      'context-menu:show',
      async (_event, items: Array<{ id: string; label?: string; enabled?: boolean }>) => {
        return new Promise<string | null>((resolve) => {
          const menu = Menu.buildFromTemplate(
            items.map((item) => {
              if (item.id === 'separator') return { type: 'separator' as const }
              return {
                label: item.label ?? item.id,
                enabled: item.enabled ?? true,
                click: (): void => resolve(item.id)
              }
            })
          )
          menu.popup({ window: mainWindow!, callback: () => resolve(null) })
        })
      }
    )

    // Canvas pinch forwarding for smoother trackpad zoom
    ipcMain.on('canvas:forward-pinch', (_event, deltaY: number) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('canvas:pinch', deltaY)
    })

    // Hooks IPC handlers
    ipcMain.handle('hooks:inject', async (_event, folderPath: string) => {
      await Promise.all([
        injectHooks(folderPath),
        injectOpenCodeHooks(folderPath),
        injectCodexHooks(folderPath),
        injectGeminiHooks(folderPath)
      ])
      if (mainWindow) startFileWatcher(folderPath, mainWindow)
    })
    ipcMain.handle('hooks:remove', async (_event, folderPath: string) => {
      await Promise.all([
        removeHooks(folderPath),
        removeOpenCodeHooks(folderPath),
        removeCodexHooks(folderPath),
        removeGeminiHooks(folderPath)
      ])
      stopFileWatcher()
    })

    // Multi-folder hooks inject/remove
    ipcMain.handle('hooks:inject-all', async (_event, folderPaths: string[]) => {
      await Promise.all(folderPaths.map((fp) => Promise.all([
        injectHooks(fp),
        injectOpenCodeHooks(fp),
        injectCodexHooks(fp),
        injectGeminiHooks(fp)
      ])))
      if (mainWindow) startMultiFileWatcher(folderPaths, mainWindow)
    })
    ipcMain.handle('hooks:remove-all', async (_event, folderPaths: string[]) => {
      await Promise.all(folderPaths.map((fp) => Promise.all([
        removeHooks(fp),
        removeOpenCodeHooks(fp),
        removeCodexHooks(fp),
        removeGeminiHooks(fp)
      ])))
      stopFileWatcher()
    })

    // Workspace file operations
    ipcMain.handle('workspace-file:save-dialog', async () => {
      if (!mainWindow) return null
      const { dialog } = await import('electron')
      const result = await dialog.showSaveDialog(mainWindow, {
        filters: [{ name: 'Multiterm Workspace', extensions: ['multiterm-workspace'] }],
        defaultPath: 'workspace.multiterm-workspace'
      })
      return result.canceled ? null : result.filePath
    })
    ipcMain.handle('workspace-file:open-dialog', async () => {
      if (!mainWindow) return null
      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Multiterm Workspace', extensions: ['multiterm-workspace'] }]
      })
      return result.canceled ? null : result.filePaths[0] ?? null
    })
    ipcMain.handle('workspace-file:load', async (_event, filePath: string) => {
      return loadWorkspaceFile(filePath)
    })
    ipcMain.handle('workspace-file:save', async (_event, filePath: string, data: MultiTermWorkspace) => {
      await saveWorkspaceFile(filePath, data)
    })

    // Save layout into workspace file
    ipcMain.handle('layout:save-workspace', async (_event, wsFilePath: string, layout: LayoutSnapshot, expandedDirs: Record<string, string[]>) => {
      const existing = await loadWorkspaceFile(wsFilePath)
      if (existing) {
        existing.layout = layout
        existing.expandedDirs = expandedDirs
        lastSaveData = { mode: 'workspace', wsFilePath, layout, expandedDirs, folders: existing.folders }
        await saveWorkspaceFile(wsFilePath, existing)
      }
    })

    // Native UI zoom (Cmd+= / Cmd+- / Cmd+0) and fullscreen (Shift+Cmd+F)
    ipcMain.on('zoom:in', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.zoomLevel = Math.min(mainWindow.webContents.zoomLevel + 0.5, 5)
    })
    ipcMain.on('zoom:out', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.zoomLevel = Math.max(mainWindow.webContents.zoomLevel - 0.5, -3)
    })
    ipcMain.on('zoom:reset', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.zoomLevel = 0
    })
    ipcMain.on('fullscreen:toggle', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen())
    })
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Settings IPC handlers
ipcMain.handle('settings:get', (_event, key: string) => getSetting(key))
ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
  setSetting(key, value)
})
ipcMain.handle('terminal:set-mouse-mode', (_event, enabled: boolean) => {
  setTmuxMouseMode(enabled)
  setSetting('terminal.mouseMode', enabled)
})

// Workspace config IPC handlers
ipcMain.handle('workspace:load', async (_event, folderPath: string) => {
  return loadWorkspaceConfig(folderPath)
})
ipcMain.handle('workspace:save', async (_event, folderPath: string, config: unknown) => {
  await saveWorkspaceConfig(folderPath, config as { selected_file: string | null; expanded_dirs: string[] })
})

// Layout persistence IPC handlers
ipcMain.handle('layout:save', async (_event, folderPath: string, layout: LayoutSnapshot) => {
  lastSaveData = { mode: 'folder', folderPath, layout }
  await saveLayout(folderPath, layout)
  await ensureGitignore(folderPath)
})

ipcMain.handle('layout:load', async (_event, folderPath: string) => {
  const layout = await loadLayout(folderPath)
  // Clean up orphaned tmux sessions that don't match the loaded layout
  if (layout && typeof layout === 'object' && 'panelIds' in layout) {
    const panelIds = (layout as { panelIds?: string[] }).panelIds ?? []
    cleanupOrphanSessions(panelIds)
  }
  return layout
})

// Synchronous save on quit to capture any last-second changes
app.on('before-quit', () => {
  if (lastSaveData !== null) {
    if (lastSaveData.mode === 'workspace') {
      const { saveWorkspaceFileSync } = require('./workspaceFileManager') as typeof import('./workspaceFileManager')
      saveWorkspaceFileSync(lastSaveData.wsFilePath, {
        version: 1,
        folders: lastSaveData.folders,
        layout: lastSaveData.layout,
        expandedDirs: lastSaveData.expandedDirs
      })
    } else {
      saveLayoutSync(lastSaveData.folderPath, lastSaveData.layout)
    }
  }
  stopFileWatcher()
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

  initSettings()
  const mouseMode = getSetting('terminal.mouseMode')
  if (mouseMode === false) setTmuxMouseMode(false)

  electronApp.setAppUserModelId('com.multiterm.studio')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  installCli()

  // Build application menu bar
  const isMac = process.platform === 'darwin'
  const sendToRenderer = (channel: string): void => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.webContents.send(channel)
  }
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { label: 'Settings…', accelerator: 'Cmd+,', click: () => sendToRenderer('menu:settings') },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Terminal', accelerator: 'CmdOrCtrl+T', click: () => sendToRenderer('menu:new-terminal') },
        { label: 'New Note', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendToRenderer('menu:new-note') },
        { type: 'separator' },
        { label: 'Duplicate', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendToRenderer('menu:duplicate') },
        { type: 'separator' },
        { label: 'Close Tile', accelerator: 'CmdOrCtrl+W', click: () => sendToRenderer('menu:close-tile') }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom to Fit All', accelerator: 'CmdOrCtrl+Alt+0', click: () => sendToRenderer('menu:zoom-fit-all') },
        { label: 'Zoom to Fit Focused', accelerator: 'CmdOrCtrl+Alt+F', click: () => sendToRenderer('menu:zoom-fit-focused') },
        { type: 'separator' },
        { label: 'Tidy Selection', accelerator: 'CmdOrCtrl+Alt+T', click: () => sendToRenderer('menu:tidy') },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendToRenderer('menu:toggle-sidebar') },
        { type: 'separator' },
        { label: 'Navigate Left', accelerator: 'CmdOrCtrl+Alt+Left', click: () => sendToRenderer('menu:nav-left') },
        { label: 'Navigate Right', accelerator: 'CmdOrCtrl+Alt+Right', click: () => sendToRenderer('menu:nav-right') },
        { label: 'Navigate Up', accelerator: 'CmdOrCtrl+Alt+Up', click: () => sendToRenderer('menu:nav-up') },
        { label: 'Navigate Down', accelerator: 'CmdOrCtrl+Alt+Down', click: () => sendToRenderer('menu:nav-down') },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const }] : [])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))

  createWindow()

  // Initialize auto-updater with cleanup callback for PTY sessions
  updateManager.init({
    onBeforeQuit: async () => {
      stopFileWatcher()
      if (rpcCleanup) {
        rpcCleanup()
        rpcCleanup = null
      }
    }
  })

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
