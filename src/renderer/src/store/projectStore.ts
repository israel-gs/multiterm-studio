import { create } from 'zustand'

export interface ProjectStore {
  folderPath: string | null
  setFolderPath: (path: string) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  folderPath: null,
  setFolderPath: (path) => set({ folderPath: path })
}))
