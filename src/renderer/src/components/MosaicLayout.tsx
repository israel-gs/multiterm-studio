import { useState, useRef, useEffect } from 'react'
import { Mosaic, getLeaves } from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import { PanelWindow } from './PanelWindow'
import { usePanelStore } from '../store/panelStore'

export function MosaicLayout(): React.JSX.Element {
  const addPanel = usePanelStore((s) => s.addPanel)
  const removePanel = usePanelStore((s) => s.removePanel)

  // Generate initial panel id — must be stable (not re-created on re-render)
  const initialIdRef = useRef<string>(crypto.randomUUID())
  const [tree, setTree] = useState<MosaicNode<string> | null>(initialIdRef.current)
  const treeRef = useRef<MosaicNode<string> | null>(initialIdRef.current)

  // Initialize first panel in store on mount
  useEffect(() => {
    addPanel(initialIdRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          renderTile={(id, path) => <PanelWindow key={id} sessionId={id} path={path} />}
          zeroStateView={zeroStateView}
          resize={{ minimumPaneSizePercentage: 5 }}
        />
      </div>
    </div>
  )
}
