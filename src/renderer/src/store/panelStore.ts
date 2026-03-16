import { create } from 'zustand'

export interface PanelMeta {
  title: string
  color: string
  attention: boolean
}

export interface PanelStore {
  panels: Record<string, PanelMeta>
  addPanel: (id: string) => void
  removePanel: (id: string) => void
  setTitle: (id: string, title: string) => void
  setColor: (id: string, color: string) => void
  setAttention: (id: string) => void
  clearAttention: (id: string) => void
}

export const usePanelStore = create<PanelStore>((set) => ({
  panels: {},

  addPanel: (id) =>
    set((s) => ({
      panels: { ...s.panels, [id]: { title: 'Terminal', color: '#569cd6', attention: false } }
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
    })
}))
