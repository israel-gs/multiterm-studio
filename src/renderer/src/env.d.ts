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
      folderPath: string
    ) => Promise<Array<{ path: string; name: string; lastOpened: number; openCount: number }>>
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
  }
}
