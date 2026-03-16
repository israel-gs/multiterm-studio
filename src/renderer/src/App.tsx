import { useEffect } from 'react'
import React from 'react'
import { MosaicLayout } from './components/MosaicLayout'
import { Sidebar } from './components/Sidebar'
import { useProjectStore } from './store/projectStore'
import { usePanelStore } from './store/panelStore'

function App(): React.JSX.Element {
  const folderPath = useProjectStore((s) => s.folderPath)
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const setAttention = usePanelStore((s) => s.setAttention)
  const clearAttention = usePanelStore((s) => s.clearAttention)

  // Trigger native folder picker on first launch when no folder is set
  useEffect(() => {
    if (folderPath !== null) return
    window.electronAPI.folderOpen().then((selected) => {
      if (selected) setFolderPath(selected)
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

  function handlePickFolder(): void {
    window.electronAPI.folderOpen().then((selected) => {
      if (selected) setFolderPath(selected)
    })
  }

  if (folderPath === null) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: 'var(--bg-main)',
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

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        background: 'var(--bg-main)'
      }}
    >
      <Sidebar folderPath={folderPath} />
      <div style={{ flex: 1, minWidth: 0, height: '100vh' }}>
        <MosaicLayout />
      </div>
    </div>
  )
}

export default App
