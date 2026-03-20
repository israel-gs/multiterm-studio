import { create } from 'zustand'

export interface ProjectStore {
  folderPath: string | null
  setFolderPath: (path: string) => void
  pendingFileOpen: string | null
  openFileInEditor: (filePath: string) => void
  clearPendingFileOpen: () => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  folderPath: null,
  setFolderPath: (path) => set({ folderPath: path }),
  pendingFileOpen: null,
  openFileInEditor: (filePath) => set({ pendingFileOpen: filePath }),
  clearPendingFileOpen: () => set({ pendingFileOpen: null })
}))
