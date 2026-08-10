import { app, shell, BrowserWindow, ipcMain, Menu, dialog, protocol, net } from 'electron'
import { join } from 'path'
import { fork } from 'child_process'
import type { ChildProcess } from 'child_process'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerPtyHandlers } from './ptyManager'
import { SidecarClient } from './sidecar/client'
import { SIDECAR_CONTROL_ENDPOINT } from './sidecar/protocol'
import { initSettings, getSetting, setSetting } from './settingsManager'
import { registerFolderHandlers } from './folderManager'
import { registerFileHandlers } from './fileManager'
import { registerGitHandlers } from './gitManager'
import { registerRecentProjectsHandlers } from './recentProjectsManager'
import { saveLayout, saveLayoutSync, loadLayout, ensureGitignore } from './layoutManager'
import type { LayoutSnapshot } from './layoutManager'
import { startRpcServer } from './rpcServer'
import {
  injectHooks,
  removeHooks,
  injectOpenCodeHooks,
  removeOpenCodeHooks,
  injectCodexHooks,
  removeCodexHooks,
  injectGeminiHooks,
  removeGeminiHooks
} from './hookInjector'
import {
  startFileWatcher,
  startMultiFileWatcher,
  stopFileWatcher,
  stopWatchingFolder
} from './fileWatcher'
import { installCli } from './cliInstaller'
import { loadWorkspaceConfig, saveWorkspaceConfig } from './workspaceConfig'
import {
  loadGoals,
  setGoal,
  pruneGoals,
  completeGoal,
  reopenGoal,
  setStepDone,
  approveProposal,
  rejectProposal
} from './sessionGoal'
import { loadWorkspaceFile, saveWorkspaceFile, saveWorkspaceFileSync } from './workspaceFileManager'
import type { MultiTermWorkspace } from './workspaceFileManager'
import { setupUpdateIPC, updateManager } from './updater'
import { launchTargetFromArgv } from './launchTarget'
import { isPathInsideRoots } from './pathGuard'
import { setErrorSink } from './errorReporter'

// Set app name early — used by macOS menu bar
app.setName('Multiterm Studio')

// Only one instance may run: two would race over the same sidecar control
// socket and the same ~/.multiterm-studio/socket-path discovery file, leaving
// agent hooks talking to whichever window happened to start last.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

/**
 * Folders the local-resource:// protocol may serve from — the workspace roots
 * currently open. Kept in the main process so the renderer cannot widen it by
 * asking for a path outside them.
 */
let resourceRoots: string[] = []

/** Folder/workspace requested on the command line, pending renderer pickup. */
let pendingOpenPath: string | null = launchTargetFromArgv(process.argv)

/** Hands a path to the renderer, or parks it until the renderer asks. */
function requestOpenPath(target: string | null): void {
  if (!target) return
  pendingOpenPath = target
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:open-path', target)
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// A second `multiterm <dir>` invocation reuses this instance instead of
// starting a rival one.
app.on('second-instance', (_event, argv, workingDirectory) => {
  focusMainWindow()
  requestOpenPath(launchTargetFromArgv(argv, workingDirectory))
})

// macOS: double-clicking a .multiterm-workspace file, or `open <file>`.
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  focusMainWindow()
  requestOpenPath(filePath)
})

// Register custom protocol for serving local files (images in markdown preview, etc.)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { supportFetchAPI: true, bypassCSP: true } }
])

// Sidecar process and connected client
let sidecarProcess: ChildProcess | null = null
let sidecarClient: SidecarClient | null = null

// Cache the most-recent save data so before-quit can do a synchronous flush
let lastSaveData:
  | { mode?: 'folder'; folderPath: string; layout: LayoutSnapshot }
  | {
      mode: 'workspace'
      wsFilePath: string
      layout: LayoutSnapshot
      expandedDirs: Record<string, string[]>
      folders: Array<{ path: string }>
    }
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

  // Register PTY IPC handlers (client is guaranteed to be connected before createWindow is called)
  registerPtyHandlers(win, sidecarClient!)
  // Register folder IPC handlers for project context panel (Phase 03)
  registerFolderHandlers(win)
  // Register file read/write IPC handlers for editor tiles
  registerFileHandlers()
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
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('canvas:pinch', deltaY)
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
      // Only this folder — the rest of the workspace stays watched.
      stopWatchingFolder(folderPath)
    })

    // Multi-folder hooks inject/remove
    ipcMain.handle('hooks:inject-all', async (_event, folderPaths: string[]) => {
      await Promise.all(
        folderPaths.map((fp) =>
          Promise.all([
            injectHooks(fp),
            injectOpenCodeHooks(fp),
            injectCodexHooks(fp),
            injectGeminiHooks(fp)
          ])
        )
      )
      if (mainWindow) startMultiFileWatcher(folderPaths, mainWindow)
    })
    ipcMain.handle('hooks:remove-all', async (_event, folderPaths: string[]) => {
      await Promise.all(
        folderPaths.map((fp) =>
          Promise.all([
            removeHooks(fp),
            removeOpenCodeHooks(fp),
            removeCodexHooks(fp),
            removeGeminiHooks(fp)
          ])
        )
      )
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
        filters: [
          { name: 'Workspace Files', extensions: ['multiterm-workspace', 'code-workspace'] },
          { name: 'Multiterm Workspace', extensions: ['multiterm-workspace'] },
          { name: 'VS Code Workspace', extensions: ['code-workspace'] }
        ]
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
    ipcMain.handle('workspace-file:load', async (_event, filePath: string) => {
      return loadWorkspaceFile(filePath)
    })
    ipcMain.handle(
      'workspace-file:save',
      async (_event, filePath: string, data: MultiTermWorkspace) => {
        await saveWorkspaceFile(filePath, data)
      }
    )

    // Save layout into workspace file
    ipcMain.handle(
      'layout:save-workspace',
      async (
        _event,
        wsFilePath: string,
        layout: LayoutSnapshot,
        expandedDirs: Record<string, string[]>
      ) => {
        const existing = await loadWorkspaceFile(wsFilePath)
        if (existing) {
          existing.layout = layout
          existing.expandedDirs = expandedDirs
          lastSaveData = {
            mode: 'workspace',
            wsFilePath,
            layout,
            expandedDirs,
            folders: existing.folders
          }
          await saveWorkspaceFile(wsFilePath, existing)
        }
      }
    )

    // Workspace roots — bounds what local-resource:// is allowed to serve.
    ipcMain.on('workspace:set-roots', (_event, roots: string[]) => {
      resourceRoots = Array.isArray(roots) ? roots.filter((r) => typeof r === 'string') : []
    })

    // Launch target: the renderer asks once on mount, since it may not have
    // been listening when the path arrived.
    ipcMain.handle('app:take-open-path', () => {
      const target = pendingOpenPath
      pendingOpenPath = null
      return target
    })

    // Shell integration
    ipcMain.on('shell:show-item-in-folder', (_event, fullPath: string) => {
      shell.showItemInFolder(fullPath)
    })

    // UI zoom is handled by the menu's zoom roles, not from the renderer.
    ipcMain.on('fullscreen:toggle', () => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.setFullScreen(!mainWindow.isFullScreen())
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
// Workspace config IPC handlers
ipcMain.handle('workspace:load', async (_event, folderPath: string) => {
  return loadWorkspaceConfig(folderPath)
})
ipcMain.handle('workspace:save', async (_event, folderPath: string, config: unknown) => {
  await saveWorkspaceConfig(
    folderPath,
    config as { selected_file: string | null; expanded_dirs: string[] }
  )
})

/** The tiles a layout snapshot still contains, across every schema version. */
function liveTileIds(layout: LayoutSnapshot): string[] {
  return 'panelIds' in layout ? layout.panelIds : layout.panels.map((p) => p.id)
}

// Session goal IPC handlers
ipcMain.handle('goals:load', async (_event, folderPath: string) => loadGoals(folderPath))
ipcMain.handle(
  'goals:set',
  async (_event, folderPath: string, tileId: string | null, text: string) =>
    setGoal(folderPath, tileId, text)
)
ipcMain.handle(
  'goals:complete',
  async (_event, folderPath: string, tileId: string | null, claim: string) =>
    completeGoal(folderPath, tileId, claim)
)
ipcMain.handle('goals:reopen', async (_event, folderPath: string, tileId: string | null) =>
  reopenGoal(folderPath, tileId)
)
// Approving is what actually closes or rewrites a goal — the agent's tool call
// only ever files the proposal, whatever permission mode the session runs in.
ipcMain.handle('goals:approve', async (_event, folderPath: string, tileId: string | null) =>
  approveProposal(folderPath, tileId)
)
ipcMain.handle('goals:reject', async (_event, folderPath: string, tileId: string | null) =>
  rejectProposal(folderPath, tileId)
)
ipcMain.handle(
  'goals:step',
  async (_event, folderPath: string, tileId: string | null, index: number, done: boolean) =>
    setStepDone(folderPath, tileId, index, done)
)

// Layout persistence IPC handlers
ipcMain.handle('layout:save', async (_event, folderPath: string, layout: LayoutSnapshot) => {
  lastSaveData = { mode: 'folder', folderPath, layout }
  await saveLayout(folderPath, layout)
  await ensureGitignore(folderPath)
  // The saved layout is the authoritative list of tiles, so this is where a
  // goal left behind by a tile closed in an earlier run gets collected.
  await pruneGoals(folderPath, liveTileIds(layout))
})

ipcMain.handle('layout:load', async (_event, folderPath: string) => {
  return loadLayout(folderPath)
})

// Synchronous save on quit to capture any last-second changes
app.on('before-quit', () => {
  if (lastSaveData !== null) {
    if (lastSaveData.mode === 'workspace') {
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

  // Disconnect client and shut down sidecar
  if (sidecarClient) {
    sidecarClient.disconnect()
    sidecarClient = null
  }
  if (sidecarProcess && !sidecarProcess.killed) {
    sidecarProcess.kill('SIGTERM')
    // Give it 2 s to exit cleanly; the OS will SIGKILL if the process outlives the app
    const killTimer = setTimeout(() => {
      if (sidecarProcess && !sidecarProcess.killed) sidecarProcess.kill('SIGKILL')
    }, 2000)
    killTimer.unref()
  }
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Handle local-resource:// protocol — serves local files for markdown preview images
  protocol.handle('local-resource', (req) => {
    const filePath = decodeURIComponent(new URL(req.url).pathname)
    if (!isPathInsideRoots(filePath, resourceRoots)) {
      // Markdown in an untrusted repo could otherwise point an <img> at any
      // file on the disk and exfiltrate what it renders.
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(`file://${filePath}`)
  })

  // Persistence failures are non-fatal by design, but the user still has to
  // learn that their layout or settings did not save.
  setErrorSink((error) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('app:error', error)
    }
  })

  initSettings()

  electronApp.setAppUserModelId('com.multiterm.studio')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  installCli()

  // Boot the sidecar process and wait for it to accept connections
  const sidecarEntryPath = join(__dirname, 'sidecar-entry.js')
  sidecarProcess = fork(sidecarEntryPath, [], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    env: {
      ...process.env,
      SIDECAR_CONTROL_ENDPOINT
    }
  })

  // Poll until the sidecar accepts a connection (up to 3 s)
  const client = new SidecarClient()
  let connected = false
  const deadline = Date.now() + 3000
  while (!connected && Date.now() < deadline) {
    try {
      await client.connect(SIDECAR_CONTROL_ENDPOINT)
      connected = true
    } catch {
      await new Promise<void>((r) => setTimeout(r, 100))
    }
  }

  if (!connected) {
    dialog.showErrorBox('Fatal', 'Sidecar failed to start within 3 seconds.')
    app.quit()
    return
  }

  sidecarClient = client

  // Build application menu bar
  const isMac = process.platform === 'darwin'
  const sendToRenderer = (channel: string): void => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.webContents.send(channel)
  }
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: () => sendToRenderer('menu:settings')
              },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Terminal',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendToRenderer('menu:new-terminal')
        },
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => sendToRenderer('menu:new-note')
        },
        { type: 'separator' },
        {
          label: 'Duplicate',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => sendToRenderer('menu:duplicate')
        },
        { type: 'separator' },
        {
          label: 'Close Tile',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendToRenderer('menu:close-tile')
        },
        { type: 'separator' },
        {
          label: 'Add Folder to Workspace...',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => sendToRenderer('menu:add-folder')
        },
        { label: 'Save Workspace As...', click: () => sendToRenderer('menu:save-workspace') },
        { label: 'Open Workspace...', click: () => sendToRenderer('menu:open-workspace') }
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
        {
          label: 'Zoom to Fit All',
          accelerator: 'CmdOrCtrl+Alt+0',
          click: () => sendToRenderer('menu:zoom-fit-all')
        },
        {
          label: 'Zoom to Fit Focused',
          accelerator: 'CmdOrCtrl+Alt+F',
          click: () => sendToRenderer('menu:zoom-fit-focused')
        },
        { type: 'separator' },
        {
          label: 'Tidy Selection',
          accelerator: 'CmdOrCtrl+Alt+T',
          click: () => sendToRenderer('menu:tidy')
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendToRenderer('menu:toggle-sidebar')
        },
        {
          label: 'Toggle Tile Index',
          accelerator: 'CmdOrCtrl+Alt+B',
          click: () => sendToRenderer('menu:toggle-tile-index')
        },
        { type: 'separator' },
        {
          label: 'Navigate Left',
          accelerator: 'CmdOrCtrl+Alt+Left',
          click: () => sendToRenderer('menu:nav-left')
        },
        {
          label: 'Navigate Right',
          accelerator: 'CmdOrCtrl+Alt+Right',
          click: () => sendToRenderer('menu:nav-right')
        },
        {
          label: 'Navigate Up',
          accelerator: 'CmdOrCtrl+Alt+Up',
          click: () => sendToRenderer('menu:nav-up')
        },
        {
          label: 'Navigate Down',
          accelerator: 'CmdOrCtrl+Alt+Down',
          click: () => sendToRenderer('menu:nav-down')
        },
        { type: 'separator' },
        // Roles rather than hand-rolled keydown matching: Chromium registers
        // the platform's zoom accelerators, including the variants a non-US
        // keyboard produces, which a key-name comparison in the renderer misses.
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
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
