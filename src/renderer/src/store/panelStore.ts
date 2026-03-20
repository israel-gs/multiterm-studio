import { create } from 'zustand'
import { colors } from '../tokens'

export interface PanelMeta {
  title: string
  color: string
  attention: boolean
  type: 'terminal' | 'editor'
  filePath?: string
  dirty: boolean
  previewMode: boolean
}

export interface PanelStore {
  panels: Record<string, PanelMeta>
  addPanel: (id: string, title?: string, color?: string, type?: 'terminal' | 'editor', filePath?: string) => void
  removePanel: (id: string) => void
  setTitle: (id: string, title: string) => void
  setColor: (id: string, color: string) => void
  setAttention: (id: string) => void
  clearAttention: (id: string) => void
  setDirty: (id: string) => void
  clearDirty: (id: string) => void
  togglePreview: (id: string) => void
}

export const usePanelStore = create<PanelStore>((set) => ({
  panels: {},

  addPanel: (id, title, color, type, filePath) =>
    set((s) => ({
      panels: {
        ...s.panels,
        [id]: {
          title: title ?? (type === 'editor' && filePath ? filePath.split('/').pop()! : 'Terminal'),
          color: color ?? colors.bgCard,
          attention: false,
          type: type ?? 'terminal',
          filePath,
          dirty: false,
          previewMode: false
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
      return { panels: { ...s.panels, [id]: { ...s.panels[id], previewMode: !s.panels[id].previewMode } } }
    })
}))
