import { create } from 'zustand'

/**
 * The canvas view state that other panes need to read.
 *
 * `TerminalCanvas` owns this state locally — tile order, focus, what is off
 * screen — and mirrors it here so the tile index can render without the canvas
 * having to pass callbacks down through the whole app.
 */
export interface CanvasStore {
  /** Tile ids in canvas order, which is creation order. */
  tileOrder: string[]
  focusedId: string | null
  maximizedId: string | null
  /** Tiles with no part inside the viewport — the ones easy to lose. */
  offscreenIds: Set<string>
  setTileOrder: (ids: string[]) => void
  setFocusedId: (id: string | null) => void
  setMaximizedId: (id: string | null) => void
  setOffscreenIds: (ids: Set<string>) => void
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  tileOrder: [],
  focusedId: null,
  maximizedId: null,
  offscreenIds: new Set<string>(),
  setTileOrder: (ids) => set({ tileOrder: ids }),
  setFocusedId: (id) => set({ focusedId: id }),
  setMaximizedId: (id) => set({ maximizedId: id }),
  setOffscreenIds: (ids) =>
    set((s) => {
      // This is fed from the pan/zoom animation frame, so an identical set must
      // not become a new object — every subscriber would re-render 60 times a
      // second while the canvas moves.
      if (sameMembers(s.offscreenIds, ids)) return s
      return { offscreenIds: ids }
    })
}))

function sameMembers(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}
