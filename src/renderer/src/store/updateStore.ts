import { create } from 'zustand'

interface UpdateStoreState {
  status: UpdateState['status']
  progress?: number
  version?: string
  error?: string
  initUpdateListener: () => () => void
  checkForUpdate: () => void
  downloadUpdate: () => void
  installUpdate: () => void
}

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  status: 'idle',
  progress: undefined,
  version: undefined,
  error: undefined,

  initUpdateListener: () => {
    // Fetch initial state
    window.electronAPI
      .updateGetStatus()
      .then((state) => {
        set({
          status: state.status,
          progress: state.progress,
          version: state.version,
          error: state.error
        })
      })
      .catch(() => {})

    // Subscribe to push updates from main process
    const unsubscribe = window.electronAPI.onUpdateStatus((state) => {
      set({
        status: state.status,
        progress: state.progress,
        version: state.version,
        error: state.error
      })
    })

    return unsubscribe
  },

  checkForUpdate: () => {
    window.electronAPI.updateCheck().catch(() => {})
  },

  downloadUpdate: () => {
    window.electronAPI.updateDownload().catch(() => {})
  },

  installUpdate: () => {
    window.electronAPI.updateInstall()
  }
}))
