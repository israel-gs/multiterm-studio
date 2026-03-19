import { contextBridge, ipcRenderer } from 'electron'

// Expose the electronAPI to the renderer via contextBridge
// IMPORTANT: onPtyData uses the unsubscribe closure pattern (electron#33328)
// ipcRenderer.removeListener fails through contextBridge because the bridge
// wraps function references — the wrapper is a different object than the original.
// The fix: capture the wrapper in a closure and return it as the unsubscribe function.
contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main (two-way via invoke)
  ptyCreate: (id: string, cwd: string): Promise<void> =>
    ipcRenderer.invoke('pty:create', id, cwd),

  ptyWrite: (id: string, data: string): Promise<void> =>
    ipcRenderer.invoke('pty:write', id, data),

  ptyResize: (id: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),

  ptyKill: (id: string): Promise<void> => ipcRenderer.invoke('pty:kill', id),

  // Folder operations — project context panel (Phase 03)
  folderOpen: (): Promise<string | null> => ipcRenderer.invoke('folder:open'),

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
    ipcRenderer.invoke('layout:load', folderPath)
})
