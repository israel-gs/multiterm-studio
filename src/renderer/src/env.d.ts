/// <reference types="vite/client" />

import type { ElectronAPI } from '../../preload'

declare global {
  interface Window {
    /**
     * Bridge exposed by the preload script.
     *
     * The shape is derived from the preload implementation itself — do not
     * re-declare the methods here. Two hand-maintained copies of this surface
     * had already drifted (ptyHasProcess was typed as returning a boolean while
     * it actually resolves to an object).
     */
    electronAPI: ElectronAPI
  }
}

export {}
