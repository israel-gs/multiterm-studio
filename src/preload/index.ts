import { contextBridge, ipcRenderer, clipboard } from 'electron'
import type {
  GitCommitDetailResult,
  GitDiffResult,
  GitLogResult,
  GitStatusResult
} from '../shared/git'
import type { FileSearchResult } from '../shared/search'

/** A project or workspace shown on the welcome screen. */
export interface RecentProject {
  path: string
  name: string
  lastOpened: number
  openCount: number
  type?: 'folder' | 'workspace'
  folderNames?: string[]
}

/** Auto-updater state broadcast by the main process. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'
  progress?: number
  version?: string
  releaseNotes?: string
  error?: string
}

// Expose the electronAPI to the renderer via contextBridge
// IMPORTANT: onPtyData uses the unsubscribe closure pattern (electron#33328)
// ipcRenderer.removeListener fails through contextBridge because the bridge
// wraps function references — the wrapper is a different object than the original.
// The fix: capture the wrapper in a closure and return it as the unsubscribe function.
const api = {
  // Renderer → Main (two-way via invoke)
  ptyCreate: (id: string, cwd: string, initialCommand?: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd, initialCommand),

  ptyWrite: (id: string, data: string): Promise<void> => ipcRenderer.invoke('pty:write', id, data),

  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),

  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

  ptyGetCwd: (id: string): Promise<string | null> => ipcRenderer.invoke('pty:get-cwd', id),

  ptyCwdChanged: (id: string, cwd: string): void => ipcRenderer.send('pty:cwd-changed', id, cwd),

  ptyHasProcess: (id: string): Promise<{ hasProcess: boolean; processName: string | null }> =>
    ipcRenderer.invoke('pty:has-process', id),

  // Folder operations — project context panel (Phase 03)
  folderOpen: (): Promise<string | null> => ipcRenderer.invoke('folder:open'),

  fileOpenDialog: (filters?: { name: string; extensions: string[] }[]): Promise<string | null> =>
    ipcRenderer.invoke('file:open-dialog', filters),

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

  // PTY exit channel: fires when the shell behind a session dies (or the
  // sidecar goes away). Filtered per session id by the caller.
  onPtyExit: (
    id: string,
    callback: (info: { exitCode: number; signal?: number; disconnected?: boolean }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { id: string; exitCode: number; signal?: number; disconnected?: boolean }
    ): void => {
      if (data.id === id) callback(data)
    }
    ipcRenderer.on('pty:exit', listener)
    return () => ipcRenderer.removeListener('pty:exit', listener)
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
  fileRead: (filePath: string): Promise<string> => ipcRenderer.invoke('file:read', filePath),

  fileWrite: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('file:write', filePath, content),

  // File tree operations — rename, move, trash, create
  fileRename: (oldPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke('file:rename', oldPath, newName),
  fileMove: (sourcePath: string, targetFolder: string): Promise<string> =>
    ipcRenderer.invoke('file:move', sourcePath, targetFolder),
  fileTrash: (filePath: string): Promise<void> => ipcRenderer.invoke('file:trash', filePath),
  fileCreate: (filePath: string, content?: string): Promise<void> =>
    ipcRenderer.invoke('file:create', filePath, content ?? ''),
  folderCreate: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('folder:create', folderPath),

  /** Filename search across a project root, walked in the main process. */
  fileSearch: (rootPath: string, query: string): Promise<FileSearchResult> =>
    ipcRenderer.invoke('file:search', rootPath, query),

  // Recent projects
  projectsRecent: (): Promise<RecentProject[]> => ipcRenderer.invoke('projects:recent'),

  projectsAdd: (
    folderPath: string,
    meta?: { type?: 'folder' | 'workspace'; folderNames?: string[] }
  ): Promise<RecentProject[]> => ipcRenderer.invoke('projects:add', folderPath, meta),

  projectsRemove: (folderPath: string): Promise<RecentProject[]> =>
    ipcRenderer.invoke('projects:remove', folderPath),

  // Git operations — branch switching
  gitIsRepo: (folderPath: string): Promise<boolean> =>
    ipcRenderer.invoke('git:is-repo', folderPath),

  gitBranches: (
    folderPath: string
  ): Promise<{ current: string; branches: string[]; detached: boolean }> =>
    ipcRenderer.invoke('git:branches', folderPath),

  gitCheckout: (folderPath: string, branch: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:checkout', folderPath, branch),

  gitCreateBranch: (
    folderPath: string,
    branchName: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:create-branch', folderPath, branchName),

  gitDeleteBranch: (
    folderPath: string,
    branchName: string
  ): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('git:delete-branch', folderPath, branchName),

  // Git operations — working tree
  gitStatus: (folderPath: string): Promise<GitStatusResult> =>
    ipcRenderer.invoke('git:status', folderPath),

  /**
   * `staged` compares the index against HEAD instead of the disk against the
   * index; `sha` overrides both and compares that commit against its parent.
   */
  gitDiff: (
    folderPath: string,
    filePath: string,
    staged = false,
    sha?: string
  ): Promise<GitDiffResult> => ipcRenderer.invoke('git:diff', folderPath, filePath, staged, sha),

  gitLog: (folderPath: string, limit?: number, skip?: number): Promise<GitLogResult> =>
    ipcRenderer.invoke('git:log', folderPath, limit, skip),

  gitCommitDetail: (folderPath: string, sha: string): Promise<GitCommitDetailResult> =>
    ipcRenderer.invoke('git:commit-detail', folderPath, sha),

  // Agent spawning push channel (PreToolUse:Agent → create panel per agent)
  onAgentSpawning: (
    callback: (data: {
      agentName: string
      toolUseId: string
      subagentsDir: string
      ptySessionId: string
      cwd: string
      viewerPath: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: {
        agentName: string
        toolUseId: string
        subagentsDir: string
        ptySessionId: string
        cwd: string
        viewerPath: string
      }
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
    const listener = (_event: Electron.IpcRendererEvent, data: { sessionId: string }): void =>
      callback(data)
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
      'menu:new-terminal',
      'menu:new-note',
      'menu:duplicate',
      'menu:close-tile',
      'menu:zoom-fit-all',
      'menu:zoom-fit-focused',
      'menu:tidy',
      'menu:toggle-sidebar',
      'menu:toggle-tile-index',
      'menu:settings',
      'menu:nav-left',
      'menu:nav-right',
      'menu:nav-up',
      'menu:nav-down',
      'menu:add-folder',
      'menu:save-workspace',
      'menu:open-workspace'
    ]
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
  fullscreenToggle: (): void => ipcRenderer.send('fullscreen:toggle'),

  // Workspace config per project
  workspaceLoad: (
    folderPath: string
  ): Promise<{ selected_file: string | null; expanded_dirs: string[] }> =>
    ipcRenderer.invoke('workspace:load', folderPath),
  workspaceSave: (
    folderPath: string,
    config: { selected_file: string | null; expanded_dirs: string[] }
  ): Promise<void> => ipcRenderer.invoke('workspace:save', folderPath, config),

  // Settings persistence
  settingsGet: (key: string): Promise<unknown> => ipcRenderer.invoke('settings:get', key),
  settingsSet: (key: string, value: unknown): Promise<void> =>
    ipcRenderer.invoke('settings:set', key, value),

  // Hook injection for Claude Code integration
  hooksInject: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('hooks:inject', folderPath),

  hooksRemove: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('hooks:remove', folderPath),

  // Multi-folder hooks
  hooksInjectAll: (folderPaths: string[]): Promise<void> =>
    ipcRenderer.invoke('hooks:inject-all', folderPaths),

  hooksRemoveAll: (folderPaths: string[]): Promise<void> =>
    ipcRenderer.invoke('hooks:remove-all', folderPaths),

  // Workspace file operations
  workspaceFileSaveDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('workspace-file:save-dialog'),

  workspaceFileOpenDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('workspace-file:open-dialog'),

  workspaceFileLoad: (filePath: string): Promise<unknown> =>
    ipcRenderer.invoke('workspace-file:load', filePath),

  workspaceFileSave: (filePath: string, data: unknown): Promise<void> =>
    ipcRenderer.invoke('workspace-file:save', filePath, data),

  // Save layout into workspace file
  layoutSaveWorkspace: (
    wsFilePath: string,
    layout: unknown,
    expandedDirs: Record<string, string[]>
  ): Promise<void> => ipcRenderer.invoke('layout:save-workspace', wsFilePath, layout, expandedDirs),

  // Auto-update API
  updateGetStatus: (): Promise<UpdateState> => ipcRenderer.invoke('update:getStatus'),

  updateCheck: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),

  updateDownload: (): Promise<UpdateState> => ipcRenderer.invoke('update:download'),

  updateInstall: (): void => {
    ipcRenderer.send('update:install')
  },

  onUpdateStatus: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
      callback(state)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },

  // Declares which folders local-resource:// may serve files from.
  workspaceSetRoots: (roots: string[]): void => ipcRenderer.send('workspace:set-roots', roots),

  // Failures the main process wants the user to see (failed saves, etc.)
  onAppError: (callback: (error: { message: string; detail?: string }) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      error: { message: string; detail?: string }
    ): void => callback(error)
    ipcRenderer.on('app:error', listener)
    return () => ipcRenderer.removeListener('app:error', listener)
  },

  // Launch target — folder/workspace passed on the command line or via Finder
  appTakeOpenPath: (): Promise<string | null> => ipcRenderer.invoke('app:take-open-path'),

  onOpenPath: (callback: (path: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('app:open-path', listener)
    return () => ipcRenderer.removeListener('app:open-path', listener)
  },

  // Shell integration
  shellShowItemInFolder: (fullPath: string): void => {
    ipcRenderer.send('shell:show-item-in-folder', fullPath)
  },

  // Clipboard
  clipboardWriteText: (text: string): void => clipboard.writeText(text),
  clipboardReadText: (): string => clipboard.readText()
}

/**
 * The renderer's view of the bridge is derived from this object rather than
 * hand-written, so the two can never drift apart.
 */
export type ElectronAPI = typeof api

contextBridge.exposeInMainWorld('electronAPI', api)
