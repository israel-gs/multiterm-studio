import { contextBridge, ipcRenderer } from 'electron'

// Expose the electronAPI to the renderer via contextBridge
// IMPORTANT: onPtyData uses the unsubscribe closure pattern (electron#33328)
// ipcRenderer.removeListener fails through contextBridge because the bridge
// wraps function references — the wrapper is a different object than the original.
// The fix: capture the wrapper in a closure and return it as the unsubscribe function.
contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main (two-way via invoke)
  ptyCreate: (id: string, cwd: string, initialCommand?: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd, initialCommand),

  ptyWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('pty:write', id, data),

  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),

  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

  ptySendKeys: (id: string, text: string, enter?: boolean): Promise<void> =>
    ipcRenderer.invoke('pty:send-keys', id, text, enter ?? false),

  ptyListPanes: (id: string): Promise<Array<{ index: number; command: string; title: string; active: boolean; pid: number }>> =>
    ipcRenderer.invoke('pty:list-panes', id),

  ptySelectPane: (id: string, paneIndex: number): Promise<void> =>
    ipcRenderer.invoke('pty:select-pane', id, paneIndex),

  ptyGetCwd: (id: string): Promise<string | null> => ipcRenderer.invoke('pty:get-cwd', id),

  ptyHasProcess: (id: string): Promise<boolean> => ipcRenderer.invoke('pty:has-process', id),

  // Folder operations — project context panel (Phase 03)
  folderOpen: (): Promise<string | null> => ipcRenderer.invoke('folder:open'),

  fileOpenDialog: (
    filters?: { name: string; extensions: string[] }[]
  ): Promise<string | null> => ipcRenderer.invoke('file:open-dialog', filters),

  folderReaddir: (
    dirPath: string
  ): Promise<Array<{ name: string; isDir: boolean; itemCount?: number; modifiedAt?: number }>> =>
    ipcRenderer.invoke('folder:readdir', dirPath),

  // Main → Renderer (push) — returns unsubscribe function
  // NOTE: listener is created inside this function so we hold the EXACT reference
  // registered with ipcRenderer.on — this is what makes removeListener work.
  onPtyData: (id: string, callback: (data: string) => void): (() => void) => {
    const channel = `pty:data:${id}`
    const listener = (_event: Electron.IpcRendererEvent, data: string): void => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  // Scrollback recovery: fires once with recovered scrollback text on session reconnect
  onPtyScrollback: (id: string, callback: (data: string) => void): (() => void) => {
    const channel = `pty:scrollback:${id}`
    const listener = (_event: Electron.IpcRendererEvent, data: string): void => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  // Attention push channel: fires when PTY output matches an interactive prompt pattern
  onAttention: (callback: (data: { id: string; snippet: string }) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { id: string; snippet: string }
    ): void => callback(data)
    ipcRenderer.on('pty:attention', listener)
    return () => ipcRenderer.removeListener('pty:attention', listener)
  },

  // Panel focus push channel: fires when a native notification is clicked
  onPanelFocus: (callback: (id: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, id: string): void => callback(id)
    ipcRenderer.on('panel:focus', listener)
    return () => ipcRenderer.removeListener('panel:focus', listener)
  },

  // Layout persistence — saves and loads .multiterm/layout.json per project folder
  layoutSave: (folderPath: string, layout: unknown): Promise<void> =>
    ipcRenderer.invoke('layout:save', folderPath, layout),

  layoutLoad: (folderPath: string): Promise<unknown> =>
    ipcRenderer.invoke('layout:load', folderPath),

  // File read/write — for editor tiles
  fileRead: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('file:read', filePath),

  fileWrite: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('file:write', filePath, content),

  // File tree operations — rename, move, trash, create
  fileRename: (oldPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke('file:rename', oldPath, newName),
  fileMove: (sourcePath: string, targetFolder: string): Promise<string> =>
    ipcRenderer.invoke('file:move', sourcePath, targetFolder),
  fileTrash: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('file:trash', filePath),
  fileCreate: (filePath: string, content?: string): Promise<void> =>
    ipcRenderer.invoke('file:create', filePath, content ?? ''),
  folderCreate: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('folder:create', folderPath),

  // Recent projects
  projectsRecent: (): Promise<
    Array<{ path: string; name: string; lastOpened: number; openCount: number }>
  > => ipcRenderer.invoke('projects:recent'),

  projectsAdd: (
    folderPath: string
  ): Promise<Array<{ path: string; name: string; lastOpened: number; openCount: number }>> =>
    ipcRenderer.invoke('projects:add', folderPath),

  projectsRemove: (
    folderPath: string
  ): Promise<Array<{ path: string; name: string; lastOpened: number; openCount: number }>> =>
    ipcRenderer.invoke('projects:remove', folderPath),

  // Git operations — branch switching
  gitIsRepo: (folderPath: string): Promise<boolean> =>
    ipcRenderer.invoke('git:is-repo', folderPath),

  gitBranches: (
    folderPath: string
  ): Promise<{ current: string; branches: string[]; detached: boolean }> =>
    ipcRenderer.invoke('git:branches', folderPath),

  gitCheckout: (
    folderPath: string,
    branch: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:checkout', folderPath, branch),

  // Agent spawning push channel (PreToolUse:Agent → create panel per agent)
  onAgentSpawning: (
    callback: (data: {
      agentName: string
      toolUseId: string
      subagentsDir: string
      ptySessionId: string
      cwd: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { agentName: string; toolUseId: string; subagentsDir: string; ptySessionId: string; cwd: string }
    ): void => callback(data)
    ipcRenderer.on('agent:spawning', listener)
    return () => ipcRenderer.removeListener('agent:spawning', listener)
  },

  // Agent session push channels (SessionStart/End → session tracking)
  onAgentSessionStarted: (
    callback: (data: { sessionId: string; ptySessionId: string | null; cwd: string }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; ptySessionId: string | null; cwd: string }
    ): void => callback(data)
    ipcRenderer.on('agent:session-started', listener)
    return () => ipcRenderer.removeListener('agent:session-started', listener)
  },

  onAgentFileTouched: (
    callback: (data: {
      sessionId: string
      ptySessionId: string | null
      filePath: string
      touchType: 'read' | 'write'
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: {
        sessionId: string
        ptySessionId: string | null
        filePath: string
        touchType: 'read' | 'write'
      }
    ): void => callback(data)
    ipcRenderer.on('agent:file-touched', listener)
    return () => ipcRenderer.removeListener('agent:file-touched', listener)
  },

  onAgentSessionEnded: (
    callback: (data: { sessionId: string; ptySessionId: string | null }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; ptySessionId: string | null }
    ): void => callback(data)
    ipcRenderer.on('agent:session-ended', listener)
    return () => ipcRenderer.removeListener('agent:session-ended', listener)
  },

  // Pane management push channels (RPC server → renderer)
  onPaneCreate: (
    callback: (data: {
      sessionId: string
      cwd: string
      title?: string
      parentSessionId?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; cwd: string; title?: string; parentSessionId?: string }
    ): void => callback(data)
    ipcRenderer.on('pane:create', listener)
    return () => ipcRenderer.removeListener('pane:create', listener)
  },

  onPaneFocus: (callback: (data: { sessionId: string }) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string }
    ): void => callback(data)
    ipcRenderer.on('pane:focus', listener)
    return () => ipcRenderer.removeListener('pane:focus', listener)
  },

  // Renderer → Main: acknowledge pane creation
  paneCreated: (sessionId: string): void => {
    ipcRenderer.send('pane:created', sessionId)
  },

  // File watcher push channel: fires when files change in the project directory
  onFsChanged: (
    callback: (changes: Array<{ path: string; relativePath: string; type: string }>) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      changes: Array<{ path: string; relativePath: string; type: string }>
    ): void => callback(changes)
    ipcRenderer.on('fs:changed', listener)
    return () => ipcRenderer.removeListener('fs:changed', listener)
  },

  // Native context menu
  contextMenuShow: (
    items: Array<{ id: string; label?: string; enabled?: boolean }>
  ): Promise<string | null> => ipcRenderer.invoke('context-menu:show', items),

  // Canvas pinch forwarding
  canvasForwardPinch: (deltaY: number): void => {
    ipcRenderer.send('canvas:forward-pinch', deltaY)
  },

  onCanvasPinch: (callback: (deltaY: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, deltaY: number): void => callback(deltaY)
    ipcRenderer.on('canvas:pinch', listener)
    return () => ipcRenderer.removeListener('canvas:pinch', listener)
  },

  // Menu bar actions
  onMenuAction: (callback: (action: string) => void): (() => void) => {
    const channels = [
      'menu:new-terminal', 'menu:new-note', 'menu:duplicate', 'menu:close-tile',
      'menu:zoom-fit-all', 'menu:zoom-fit-focused', 'menu:tidy',
      'menu:toggle-sidebar', 'menu:settings',
      'menu:nav-left', 'menu:nav-right', 'menu:nav-up', 'menu:nav-down'
    ]
    const listener = (event: Electron.IpcRendererEvent): void => {
      const ch = (event as unknown as { channel?: string }).channel
      if (ch) callback(ch.replace('menu:', ''))
    }
    // Use a single wrapper per channel
    const listeners = channels.map((ch) => {
      const fn = (): void => callback(ch.replace('menu:', ''))
      ipcRenderer.on(ch, fn)
      return { ch, fn }
    })
    return () => {
      for (const { ch, fn } of listeners) ipcRenderer.removeListener(ch, fn)
    }
  },

  // Native zoom and fullscreen
  zoomIn: (): void => ipcRenderer.send('zoom:in'),
  zoomOut: (): void => ipcRenderer.send('zoom:out'),
  zoomReset: (): void => ipcRenderer.send('zoom:reset'),
  fullscreenToggle: (): void => ipcRenderer.send('fullscreen:toggle'),

  // Workspace config per project
  workspaceLoad: (folderPath: string): Promise<{ selected_file: string | null; expanded_dirs: string[] }> =>
    ipcRenderer.invoke('workspace:load', folderPath),
  workspaceSave: (folderPath: string, config: { selected_file: string | null; expanded_dirs: string[] }): Promise<void> =>
    ipcRenderer.invoke('workspace:save', folderPath, config),

  // Settings persistence
  settingsGet: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),
  terminalSetMouseMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('terminal:set-mouse-mode', enabled),

  // Hook injection for Claude Code integration
  hooksInject: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('hooks:inject', folderPath),

  hooksRemove: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('hooks:remove', folderPath),

  // Auto-update API
  updateGetStatus: (): Promise<{
    status: string
    progress?: number
    version?: string
    releaseNotes?: string
    error?: string
  }> => ipcRenderer.invoke('update:getStatus'),

  updateCheck: (): Promise<{
    status: string
    progress?: number
    version?: string
    releaseNotes?: string
    error?: string
  }> => ipcRenderer.invoke('update:check'),

  updateDownload: (): Promise<{
    status: string
    progress?: number
    version?: string
    releaseNotes?: string
    error?: string
  }> => ipcRenderer.invoke('update:download'),

  updateInstall: (): void => {
    ipcRenderer.send('update:install')
  },

  onUpdateStatus: (
    callback: (state: {
      status: string
      progress?: number
      version?: string
      releaseNotes?: string
      error?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: {
        status: string
        progress?: number
        version?: string
        releaseNotes?: string
        error?: string
      }
    ): void => callback(state)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  }
})
