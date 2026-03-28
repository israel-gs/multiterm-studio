import { create } from 'zustand'

export interface AgentSpawnRequest {
  agentName: string
  toolUseId: string
  subagentsDir: string
  cwd: string
}

export interface PaneCreateRequest {
  sessionId: string
  cwd: string
  title?: string
  parentSessionId?: string
}

export interface ProjectStore {
  // Multi-folder workspace support
  folderPaths: string[]
  workspaceFilePath: string | null
  setFolderPaths: (paths: string[]) => void
  addFolderPath: (path: string) => void
  removeFolderPath: (path: string) => void
  setWorkspaceFilePath: (path: string | null) => void
  // Backwards-compat: derived from folderPaths[0]
  folderPath: string | null
  setFolderPath: (path: string) => void
  pendingFileOpen: string | null
  openFileInEditor: (filePath: string) => void
  clearPendingFileOpen: () => void
  pendingAgentSpawn: AgentSpawnRequest | null
  spawnAgentTerminal: (req: AgentSpawnRequest) => void
  clearPendingAgentSpawn: () => void
  pendingPaneCreate: PaneCreateRequest | null
  spawnInteractivePane: (req: PaneCreateRequest) => void
  clearPendingPaneCreate: () => void
  pendingTerminalCwd: string | null
  openTerminalAt: (cwd: string) => void
  clearPendingTerminalCwd: () => void
  fsRefreshKey: number
  bumpFsRefresh: () => void
  expandedDirs: Set<string>
  setExpandedDirs: (dirs: Set<string>) => void
  toggleExpandedDir: (dir: string) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  // Multi-folder workspace
  folderPaths: [],
  workspaceFilePath: null,
  setFolderPaths: (paths) => set({ folderPaths: paths, folderPath: paths[0] ?? null }),
  addFolderPath: (path) => {
    const paths = get().folderPaths
    if (paths.includes(path)) return
    const next = [...paths, path]
    set({ folderPaths: next, folderPath: next[0] ?? null })
  },
  removeFolderPath: (path) => {
    const next = get().folderPaths.filter((p) => p !== path)
    set({ folderPaths: next, folderPath: next[0] ?? null })
  },
  setWorkspaceFilePath: (path) => set({ workspaceFilePath: path }),
  // Backwards-compat
  folderPath: null,
  setFolderPath: (path) => set({ folderPath: path, folderPaths: [path], workspaceFilePath: null }),
  pendingFileOpen: null,
  openFileInEditor: (filePath) => set({ pendingFileOpen: filePath }),
  clearPendingFileOpen: () => set({ pendingFileOpen: null }),
  pendingAgentSpawn: null,
  spawnAgentTerminal: (req) => set({ pendingAgentSpawn: req }),
  clearPendingAgentSpawn: () => set({ pendingAgentSpawn: null }),
  pendingPaneCreate: null,
  spawnInteractivePane: (req) => set({ pendingPaneCreate: req }),
  clearPendingPaneCreate: () => set({ pendingPaneCreate: null }),
  pendingTerminalCwd: null,
  openTerminalAt: (cwd) => set({ pendingTerminalCwd: cwd }),
  clearPendingTerminalCwd: () => set({ pendingTerminalCwd: null }),
  fsRefreshKey: 0,
  bumpFsRefresh: () => set((s) => ({ fsRefreshKey: s.fsRefreshKey + 1 })),
  expandedDirs: new Set<string>(),
  setExpandedDirs: (dirs) => set({ expandedDirs: dirs }),
  toggleExpandedDir: (dir) =>
    set((s) => {
      const next = new Set(s.expandedDirs)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return { expandedDirs: next }
    })
}))
