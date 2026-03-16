import { useState, useRef, useEffect } from 'react'
import { Mosaic, getLeaves } from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import { PanelWindow } from './PanelWindow'
import { usePanelStore } from '../store/panelStore'
import { useProjectStore } from '../store/projectStore'
import { scheduleSave } from '../utils/layoutPersistence'

export interface SavedLayoutShape {
  version: number
  tree: MosaicNode<string> | null
  panels: Array<{ id: string; title: string; color: string }>
}

interface MosaicLayoutProps {
  savedLayout?: SavedLayoutShape | null
}

export function MosaicLayout({ savedLayout }: MosaicLayoutProps): React.JSX.Element {
  const addPanel = usePanelStore((s) => s.addPanel)
  const removePanel = usePanelStore((s) => s.removePanel)
  const folderPath = useProjectStore((s) => s.folderPath)

  // Generate initial panel id — only used when there is no savedLayout
  const initialIdRef = useRef<string>(crypto.randomUUID())

  // Determine starting tree: saved tree or a fresh single-panel leaf
  const startTree: MosaicNode<string> | null =
    savedLayout != null ? (savedLayout.tree ?? null) : initialIdRef.current

  const [tree, setTree] = useState<MosaicNode<string> | null>(startTree)
  const treeRef = useRef<MosaicNode<string> | null>(startTree)

  // Initialize panel store on mount: restore from saved layout or create fresh panel
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
      // Check if any title or color changed (not attention)
      for (const id of Object.keys(state.panels)) {
        const cur = state.panels[id]
        const prevPanel = prev.panels[id]
        if (prevPanel && (cur.title !== prevPanel.title || cur.color !== prevPanel.color)) {
          if (folderPath) {
            scheduleSave(folderPath, buildSnapshot(treeRef.current))
          }
          return
        }
      }
    })
    return unsubscribe
  }, [folderPath])

  function buildSnapshot(currentTree: MosaicNode<string> | null): {
    version: number
    tree: MosaicNode<string> | null
    panels: Array<{ id: string; title: string; color: string }>
  } {
    const allPanels = usePanelStore.getState().panels
    const panels = Object.entries(allPanels).map(([id, meta]) => ({
      id,
      title: meta.title,
      color: meta.color
    }))
    return { version: 1, tree: currentTree, panels }
  }

  function handleChange(newTree: MosaicNode<string> | null): void {
    const oldLeaves = new Set(getLeaves(treeRef.current))
    const newLeaves = new Set(getLeaves(newTree))

    for (const id of oldLeaves) {
      if (!newLeaves.has(id)) {
        window.electronAPI.ptyKill(id)
        removePanel(id)
      }
    }

    treeRef.current = newTree
    setTree(newTree)

    // Auto-save on every tree change (split, resize, close)
    if (folderPath) {
      scheduleSave(folderPath, buildSnapshot(newTree))
    }
  }

  function handleAddPanel(): void {
    const newId = crypto.randomUUID()
    addPanel(newId)
    setTree((current) => {
      const next: MosaicNode<string> =
        current === null
          ? newId
          : {
              type: 'split',
              direction: 'row',
              children: [current, newId],
              splitPercentages: [50, 50]
            }
      treeRef.current = next
      return next
    })
  }

  const zeroStateView = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: 'var(--bg-main)'
      }}
    >
      <button
        onClick={handleAddPanel}
        style={{
          padding: '8px 16px',
          background: 'var(--bg-header)',
          color: 'var(--fg-primary)',
          border: '1px solid var(--fg-secondary)',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px'
        }}
      >
        + New terminal
      </button>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%' }}>
      {/* Global toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          background: 'var(--bg-header)',
          borderBottom: '1px solid #3e3e3e',
          flexShrink: 0
        }}
      >
        <button
          onClick={handleAddPanel}
          style={{
            padding: '4px 10px',
            background: 'transparent',
            color: 'var(--fg-primary)',
            border: '1px solid var(--fg-secondary)',
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          + New terminal
        </button>
      </div>

      {/* Mosaic canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <Mosaic<string>
          value={tree}
          onChange={handleChange}
          renderTile={(id, path) => <PanelWindow key={id} sessionId={id} path={path} cwd={folderPath ?? '.'} />}
          createNode={() => {
            const newId = crypto.randomUUID()
            addPanel(newId)
            return newId
          }}
          zeroStateView={zeroStateView}
          resize={{ minimumPaneSizePercentage: 5 }}
        />
      </div>
    </div>
  )
}
