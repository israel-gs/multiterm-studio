import { create } from 'zustand'
import type { AppearanceMode } from '../tokens'

interface AppearanceStore {
  mode: AppearanceMode
  setMode: (mode: AppearanceMode) => void
}

const STORAGE_KEY = 'multiterm-appearance'

function loadMode(): AppearanceMode {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark' || saved === 'system') return saved
  return 'dark'
}

export const useAppearanceStore = create<AppearanceStore>((set) => ({
  mode: loadMode(),
  setMode: (mode) => {
    localStorage.setItem(STORAGE_KEY, mode)
    document.documentElement.dataset.theme = mode
    set({ mode })
  }
}))

// Apply on load
document.documentElement.dataset.theme = loadMode()
