import { create } from 'zustand'
import { colors } from '../tokens'

export interface PanelMeta {
  title: string
  color: string
  attention: boolean
  type: 'terminal' | 'editor' | 'note' | 'image'
  noteContent?: string
  filePath?: string
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
    type?: 'terminal' | 'editor' | 'note' | 'image',
    filePath?: string,
    initialCommand?: string,
    cwd?: string
  ) => void
  removePanel: (id: string) => void
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
  pendingFocus: string | null
  requestFocus: (id: string) => void
  clearPendingFocus: () => void
}

export const usePanelStore = create<PanelStore>((set) => ({
  panels: {},

  addPanel: (id, title, color, type, filePath, initialCommand, cwd) =>
    set((s) => ({
      panels: {
        ...s.panels,
        [id]: {
          title:
            title ??
            (type === 'image' && filePath
              ? filePath.split('/').pop()!
              : type === 'editor' && filePath
                ? filePath.split('/').pop()!
                : type === 'note'
                  ? 'Note'
                  : 'Terminal'),
          color: color ?? colors.bgCard,
          attention: false,
          type: type ?? 'terminal',
          filePath,
          dirty: false,
          previewMode: false,
          initialCommand,
          agentActive: false,
          hasProcess: false,
          cwd
        }
      }
    })),

  removePanel: (id) =>
    set((s) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...rest } = s.panels
      return { panels: rest }
    }),

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

  pendingFocus: null,
  requestFocus: (id) => set({ pendingFocus: id }),
  clearPendingFocus: () => set({ pendingFocus: null })
}))
