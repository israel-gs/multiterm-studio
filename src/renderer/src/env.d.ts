/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    ptyCreate: (id: string, cwd: string) => Promise<void>
    ptyWrite: (id: string, data: string) => Promise<void>
    ptyResize: (id: string, cols: number, rows: number) => Promise<void>
    ptyKill: (id: string) => Promise<void>
    onPtyData: (id: string, callback: (data: string) => void) => () => void
    folderOpen: () => Promise<string | null>
    folderReaddir: (dirPath: string) => Promise<Array<{ name: string; isDir: boolean }>>
    onAttention: (callback: (data: { id: string; snippet: string }) => void) => () => void
    onPanelFocus: (callback: (id: string) => void) => () => void
    layoutSave: (folderPath: string, layout: unknown) => Promise<void>
    layoutLoad: (folderPath: string) => Promise<unknown>
    fileRead: (filePath: string) => Promise<string>
    fileWrite: (filePath: string, content: string) => Promise<void>
    projectsRecent: () => Promise<
      Array<{ path: string; name: string; lastOpened: number; openCount: number }>
    >
    projectsAdd: (
      folderPath: string,
      meta?: { type?: 'folder' | 'workspace'; folderNames?: string[] }
    ) => Promise<Array<{ path: string; name: string; lastOpened: number; openCount: number; type?: string; folderNames?: string[] }>>
    projectsRemove: (
      folderPath: string
    ) => Promise<Array<{ path: string; name: string; lastOpened: number; openCount: number }>>
    gitIsRepo: (folderPath: string) => Promise<boolean>
    gitBranches: (
      folderPath: string
    ) => Promise<{ current: string; branches: string[]; detached: boolean }>
    gitCheckout: (
      folderPath: string,
      branch: string
    ) => Promise<{ ok: boolean; error?: string }>
    gitCreateBranch: (
      folderPath: string,
      branchName: string
    ) => Promise<{ ok: boolean; error?: string }>
    gitDeleteBranch: (
      folderPath: string,
      branchName: string
    ) => Promise<{ ok: boolean; error?: string }>
    onAgentSpawning: (
      callback: (data: {
        agentName: string
        toolUseId: string
        subagentsDir: string
        cwd: string
      }) => void
    ) => () => void
    onAgentSessionStarted: (
      callback: (data: { sessionId: string; ptySessionId: string | null; cwd: string }) => void
    ) => () => void
    onAgentFileTouched: (
      callback: (data: {
        sessionId: string
        ptySessionId: string | null
        filePath: string
        touchType: 'read' | 'write'
      }) => void
    ) => () => void
    onAgentSessionEnded: (
      callback: (data: { sessionId: string; ptySessionId: string | null }) => void
    ) => () => void
    hooksInject: (folderPath: string) => Promise<void>
    hooksRemove: (folderPath: string) => Promise<void>
    hooksInjectAll: (folderPaths: string[]) => Promise<void>
    hooksRemoveAll: (folderPaths: string[]) => Promise<void>
    workspaceFileSaveDialog: () => Promise<string | null>
    workspaceFileOpenDialog: () => Promise<string | null>
    workspaceFileLoad: (filePath: string) => Promise<unknown>
    workspaceFileSave: (filePath: string, data: unknown) => Promise<void>
    layoutSaveWorkspace: (wsFilePath: string, layout: unknown, expandedDirs: Record<string, string[]>) => Promise<void>
    onPtyScrollback: (id: string, callback: (data: string) => void) => () => void
    ptySendKeys: (id: string, text: string, enter?: boolean) => Promise<void>
    ptyListPanes: (id: string) => Promise<Array<{ index: number; command: string; title: string; active: boolean; pid: number }>>
    ptySelectPane: (id: string, paneIndex: number) => Promise<void>
    ptyGetCwd: (id: string) => Promise<string | null>
    ptyHasProcess: (id: string) => Promise<unknown>
    fileOpenDialog: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    fileRename: (oldPath: string, newName: string) => Promise<string>
    fileMove: (sourcePath: string, targetFolder: string) => Promise<string>
    fileTrash: (filePath: string) => Promise<void>
    fileCreate: (filePath: string, content?: string) => Promise<void>
    folderCreate: (folderPath: string) => Promise<void>
    onPaneCreate: (callback: (data: { sessionId: string; cwd: string; title?: string; parentSessionId?: string }) => void) => () => void
    onPaneFocus: (callback: (data: { sessionId: string }) => void) => () => void
    paneCreated: (sessionId: string) => void
    onFsChanged: (callback: (changes: Array<{ path: string; relativePath: string; type: string }>) => void) => () => void
    contextMenuShow: (items: Array<{ id: string; label?: string; enabled?: boolean }>) => Promise<string | null>
    canvasForwardPinch: (deltaY: number) => void
    onCanvasPinch: (callback: (deltaY: number) => void) => () => void
    onMenuAction: (callback: (action: string) => void) => () => void
    zoomIn: () => void
    zoomOut: () => void
    zoomReset: () => void
    fullscreenToggle: () => void
    workspaceLoad: (folderPath: string) => Promise<{ selected_file: string | null; expanded_dirs: string[] }>
    workspaceSave: (folderPath: string, config: { selected_file: string | null; expanded_dirs: string[] }) => Promise<void>
    settingsGet: (key: string) => Promise<unknown>
    settingsSet: (key: string, value: unknown) => Promise<void>
    terminalSetMouseMode: (enabled: boolean) => Promise<void>
    updateGetStatus: () => Promise<{ status: string; progress?: number; version?: string; releaseNotes?: string; error?: string }>
    updateCheck: () => Promise<{ status: string; progress?: number; version?: string; releaseNotes?: string; error?: string }>
    updateDownload: () => Promise<{ status: string; progress?: number; version?: string; releaseNotes?: string; error?: string }>
    updateInstall: () => void
    onUpdateStatus: (callback: (state: { status: string; progress?: number; version?: string; releaseNotes?: string; error?: string }) => void) => () => void
    shellShowItemInFolder: (fullPath: string) => void
    clipboardWriteText: (text: string) => void
    clipboardReadText: () => string
  }
}
