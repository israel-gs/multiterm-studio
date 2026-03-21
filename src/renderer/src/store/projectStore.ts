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
  fsRefreshKey: number
  bumpFsRefresh: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  folderPath: null,
  setFolderPath: (path) => set({ folderPath: path }),
  pendingFileOpen: null,
  openFileInEditor: (filePath) => set({ pendingFileOpen: filePath }),
  clearPendingFileOpen: () => set({ pendingFileOpen: null }),
  pendingAgentSpawn: null,
  spawnAgentTerminal: (req) => set({ pendingAgentSpawn: req }),
  clearPendingAgentSpawn: () => set({ pendingAgentSpawn: null }),
  pendingPaneCreate: null,
  spawnInteractivePane: (req) => set({ pendingPaneCreate: req }),
  clearPendingPaneCreate: () => set({ pendingPaneCreate: null }),
  fsRefreshKey: 0,
  bumpFsRefresh: () => set((s) => ({ fsRefreshKey: s.fsRefreshKey + 1 }))
}))
