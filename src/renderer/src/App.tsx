import { useEffect, useState } from 'react'
import React from 'react'
import { TerminalCanvas } from './components/TerminalCanvas'
import type { SavedLayoutShape } from './components/TerminalCanvas'
import { EnhancedSidebar } from './components/EnhancedSidebar'
import { useProjectStore } from './store/projectStore'
import { usePanelStore } from './store/panelStore'

function App(): React.JSX.Element {
  const folderPath = useProjectStore((s) => s.folderPath)
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const setAttention = usePanelStore((s) => s.setAttention)
  const clearAttention = usePanelStore((s) => s.clearAttention)

  // savedLayout: null = fresh start, loaded object = restore from file
  const [savedLayout, setSavedLayout] = useState<SavedLayoutShape | null>(null)
  // layoutLoaded: true once we've attempted a load (prevents flash of default panel before restore)
  const [layoutLoaded, setLayoutLoaded] = useState(false)

  // Trigger native folder picker on first launch when no folder is set
  useEffect(() => {
    if (folderPath !== null) return
    window.electronAPI.folderOpen().then(async (selected) => {
      if (selected) {
        const layout = await window.electronAPI.layoutLoad(selected)
        setSavedLayout((layout as SavedLayoutShape) ?? null)
        setFolderPath(selected)
      }
      // Whether or not user selected a folder, mark layout as loaded
      setLayoutLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wire attention events: main process -> panelStore badge
  useEffect(() => {
    const unsubAttention = window.electronAPI.onAttention((data) => setAttention(data.id))
    const unsubPanelFocus = window.electronAPI.onPanelFocus((id) => clearAttention(id))
    return () => {
      unsubAttention()
      unsubPanelFocus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handlePickFolder(): Promise<void> {
    const selected = await window.electronAPI.folderOpen()
    if (selected) {
      const layout = await window.electronAPI.layoutLoad(selected)
      setSavedLayout((layout as SavedLayoutShape) ?? null)
      setFolderPath(selected)
      setLayoutLoaded(true)
    }
  }

  if (folderPath === null) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: 'var(--bg-canvas)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 12
        }}
      >
        <div style={{ color: 'var(--fg-secondary)', fontSize: 14 }}>
          No folder selected
        </div>
        <button
          onClick={handlePickFolder}
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
          Pick a folder
        </button>
      </div>
    )
  }

  // Only render TerminalGrid once we've attempted to load the saved layout
  // to prevent a flash of a default single panel before restoration
  if (!layoutLoaded) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: 'var(--bg-canvas)'
        }}
      />
    )
  }

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        background: 'var(--bg-canvas)'
      }}
    >
      <EnhancedSidebar folderPath={folderPath} />
      <div style={{ flex: 1, minWidth: 0, height: '100vh' }}>
        <TerminalCanvas savedLayout={savedLayout} />
      </div>
    </div>
  )
}

export default App
