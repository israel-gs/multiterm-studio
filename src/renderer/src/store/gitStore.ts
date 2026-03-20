import { create } from 'zustand'

export interface GitStore {
  isRepo: boolean
  currentBranch: string
  branches: string[]
  detached: boolean
  loading: boolean
  error: string | null
  setBranches: (data: {
    current: string
    branches: string[]
    detached: boolean
  }) => void
  setIsRepo: (isRepo: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  reset: () => void
}

export const useGitStore = create<GitStore>((set) => ({
  isRepo: false,
  currentBranch: '',
  branches: [],
  detached: false,
  loading: false,
  error: null,
  setBranches: (data) =>
    set({
      isRepo: true,
      currentBranch: data.current,
      branches: data.branches,
      detached: data.detached
    }),
  setIsRepo: (isRepo) => set({ isRepo }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () =>
    set({
      isRepo: false,
      currentBranch: '',
      branches: [],
      detached: false,
      loading: false,
      error: null
    })
}))
