import { useState, useRef, useEffect } from 'react'
import { TerminalCard } from './TerminalCard'
import { usePanelStore } from '../store/panelStore'
import { useProjectStore } from '../store/projectStore'
import { scheduleSave } from '../utils/layoutPersistence'

export interface SavedLayoutShape {
  version: number
  panelIds?: string[]
  tree?: unknown
  panels: Array<{ id: string; title: string; color: string }>
}

interface TerminalGridProps {
  savedLayout?: SavedLayoutShape | null
}

function extractLeafIds(node: unknown): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === 'string') return [node]
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.children)) {
      return obj.children.flatMap((child: unknown) => extractLeafIds(child))
    }
    if (obj.first !== undefined || obj.second !== undefined) {
      return [...extractLeafIds(obj.first), ...extractLeafIds(obj.second)]
    }
  }
  return []
}

export function TerminalGrid({ savedLayout }: TerminalGridProps): React.JSX.Element {
  const addPanel = usePanelStore((s) => s.addPanel)
  const removePanel = usePanelStore((s) => s.removePanel)
  const folderPath = useProjectStore((s) => s.folderPath)

  const initialIdRef = useRef<string>(crypto.randomUUID())

  // Determine starting panel IDs
  function getInitialIds(): string[] {
    if (savedLayout != null && savedLayout.panels.length > 0) {
      if (savedLayout.panelIds) return savedLayout.panelIds
      // v1 migration: extract leaf IDs from mosaic tree
      if (savedLayout.tree) {
        const ids = extractLeafIds(savedLayout.tree)
        return ids.length > 0 ? ids : savedLayout.panels.map((p) => p.id)
      }
      return savedLayout.panels.map((p) => p.id)
    }
    return [initialIdRef.current]
  }

  const [panelIds, setPanelIds] = useState<string[]>(getInitialIds)
  const panelIdsRef = useRef<string[]>(panelIds)

  // Initialize panel store on mount
  useEffect(() => {
    if (savedLayout != null && savedLayout.panels.length > 0) {
      for (const p of savedLayout.panels) {
        addPanel(p.id, p.title, p.color)
      }
    } else {
      addPanel(initialIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to panelStore title/color changes and trigger scheduleSave
  useEffect(() => {
    const unsubscribe = usePanelStore.subscribe((state, prev) => {
      if (state.panels === prev.panels) return
      for (const id of Object.keys(state.panels)) {
        const cur = state.panels[id]
        const prevPanel = prev.panels[id]
        if (prevPanel && (cur.title !== prevPanel.title || cur.color !== prevPanel.color)) {
          if (folderPath) {
            scheduleSave(folderPath, buildSnapshot(panelIdsRef.current))
          }
          return
        }
      }
    })
    return unsubscribe
  }, [folderPath])

  function buildSnapshot(ids: string[]): SavedLayoutShape {
    const allPanels = usePanelStore.getState().panels
    const panels = ids
      .filter((id) => allPanels[id])
      .map((id) => ({
        id,
        title: allPanels[id].title,
        color: allPanels[id].color
      }))
    return { version: 2, panelIds: ids, panels }
  }

  function handleAddPanel(): void {
    const newId = crypto.randomUUID()
    addPanel(newId)
    setPanelIds((prev) => {
      const next = [...prev, newId]
      panelIdsRef.current = next
      if (folderPath) scheduleSave(folderPath, buildSnapshot(next))
      return next
    })
  }

  function handleClosePanel(id: string): void {
    window.electronAPI.ptyKill(id)
    removePanel(id)
    setPanelIds((prev) => {
      const next = prev.filter((pid) => pid !== id)
      panelIdsRef.current = next
      if (folderPath) scheduleSave(folderPath, buildSnapshot(next))
      return next
    })
  }

  if (panelIds.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
        <div className="terminal-grid-toolbar">
          <button onClick={handleAddPanel} className="terminal-grid-add-btn">
            + New terminal
          </button>
        </div>
        <div className="terminal-grid-empty">
          <button onClick={handleAddPanel} className="terminal-grid-empty-btn">
            + New terminal
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      <div className="terminal-grid-toolbar">
        <button onClick={handleAddPanel} className="terminal-grid-add-btn">
          + New terminal
        </button>
      </div>
      <div className="terminal-grid">
        {panelIds.map((id) => (
          <TerminalCard
            key={id}
            sessionId={id}
            cwd={folderPath ?? '.'}
            onClose={handleClosePanel}
          />
        ))}
      </div>
    </div>
  )
}
