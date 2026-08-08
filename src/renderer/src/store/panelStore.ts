import { create } from 'zustand'
import { colors } from '../tokens'
import { basename } from '../utils/path'

export interface PanelMeta {
  title: string
  color: string
  attention: boolean
  type: 'terminal' | 'editor' | 'note' | 'image' | 'diff'
  noteContent?: string
  filePath?: string
  /** Diff tiles only: compare the index against HEAD instead of disk vs index. */
  diffStaged?: boolean
  dirty: boolean
  previewMode: boolean
  initialCommand?: string
  agentActive: boolean
  hasProcess: boolean
  processName?: string | null
  cwd?: string
}

export interface PanelStore {
  panels: Record<string, PanelMeta>
  addPanel: (
    id: string,
    title?: string,
    color?: string,
    type?: 'terminal' | 'editor' | 'note' | 'image' | 'diff',
    filePath?: string,
    initialCommand?: string,
    cwd?: string,
    diffStaged?: boolean
  ) => void
  removePanel: (id: string) => void
  /** Drops every panel. Used when closing a project. */
  reset: () => void
  setTitle: (id: string, title: string) => void
  setColor: (id: string, color: string) => void
  setAttention: (id: string) => void
  clearAttention: (id: string) => void
  setDirty: (id: string) => void
  clearDirty: (id: string) => void
  togglePreview: (id: string) => void
  setAgentActive: (id: string, active: boolean) => void
  setHasProcess: (id: string, has: boolean, processName?: string | null) => void
  setCwd: (id: string, cwd: string) => void
  setNoteContent: (id: string, content: string) => void
  setDiffStaged: (id: string, staged: boolean) => void
  pendingFocus: string | null
  requestFocus: (id: string) => void
  clearPendingFocus: () => void
  /**
   * A request to bring a tile into view, not just to the front — the canvas
   * pans to it. A fresh object every time so asking twice for the same tile
   * still fires the canvas subscription.
   */
  pendingReveal: { id: string; maximize: boolean } | null
  revealTile: (id: string, maximize?: boolean) => void
  clearPendingReveal: () => void
}

function defaultTitle(type: PanelMeta['type'] | undefined, filePath?: string): string {
  if (filePath && (type === 'image' || type === 'editor')) return basename(filePath)
  if (filePath && type === 'diff') return `Diff: ${basename(filePath)}`
  if (type === 'note') return 'Note'
  return 'Terminal'
}

export const usePanelStore = create<PanelStore>((set) => ({
  panels: {},

  addPanel: (id, title, color, type, filePath, initialCommand, cwd, diffStaged) =>
    set((s) => ({
      panels: {
        ...s.panels,
        [id]: {
          title: title ?? defaultTitle(type, filePath),
          color: color ?? colors.bgCard,
          attention: false,
          type: type ?? 'terminal',
          filePath,
          dirty: false,
          previewMode: false,
          initialCommand,
          agentActive: false,
          hasProcess: false,
          cwd,
          diffStaged
        }
      }
    })),

  removePanel: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...rest } = s.panels
      return { panels: rest }
    }),

  reset: () => set({ panels: {}, pendingFocus: null }),

  setTitle: (id, title) =>
    set((s) => ({
      panels: { ...s.panels, [id]: { ...s.panels[id], title } }
    })),

  setColor: (id, color) =>
    set((s) => ({
      panels: { ...s.panels, [id]: { ...s.panels[id], color } }
    })),

  setAttention: (id) =>
    set((s) => {
      if (!s.panels[id]) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], attention: true } } }
    }),

  clearAttention: (id) =>
    set((s) => {
      if (!s.panels[id]) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], attention: false } } }
    }),

  setDirty: (id) =>
    set((s) => {
      if (!s.panels[id] || s.panels[id].dirty) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], dirty: true } } }
    }),

  clearDirty: (id) =>
    set((s) => {
      if (!s.panels[id] || !s.panels[id].dirty) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], dirty: false } } }
    }),

  togglePreview: (id) =>
    set((s) => {
      if (!s.panels[id]) return s
      return {
        panels: { ...s.panels, [id]: { ...s.panels[id], previewMode: !s.panels[id].previewMode } }
      }
    }),

  setAgentActive: (id, active) =>
    set((s) => {
      if (!s.panels[id]) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], agentActive: active } } }
    }),

  setHasProcess: (id, has, processName) =>
    set((s) => {
      if (!s.panels[id]) return s
      return {
        panels: {
          ...s.panels,
          [id]: { ...s.panels[id], hasProcess: has, processName: processName ?? null }
        }
      }
    }),

  setCwd: (id, cwd) =>
    set((s) => {
      if (!s.panels[id]) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], cwd } } }
    }),

  setNoteContent: (id, content) =>
    set((s) => {
      if (!s.panels[id]) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], noteContent: content } } }
    }),

  setDiffStaged: (id, staged) =>
    set((s) => {
      if (!s.panels[id]) return s
      return { panels: { ...s.panels, [id]: { ...s.panels[id], diffStaged: staged } } }
    }),

  pendingFocus: null,
  requestFocus: (id) => set({ pendingFocus: id }),
  clearPendingFocus: () => set({ pendingFocus: null }),

  pendingReveal: null,
  revealTile: (id, maximize = false) => set({ pendingReveal: { id, maximize } }),
  clearPendingReveal: () => set({ pendingReveal: null })
}))
