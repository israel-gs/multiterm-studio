declare global {
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
    }
  }
}
