import { useEffect, useState, useRef } from 'react'
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

  // Sidebar resize/collapse state
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const prevWidthRef = useRef(300)
  const toggleSidebarRef = useRef(() => {})

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

  // Sync sidebar width to CSS custom property (drives .enhanced-sidebar width)
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      `${sidebarCollapsed ? 0 : sidebarWidth}px`
    )
  }, [sidebarWidth, sidebarCollapsed])

  // Toggle sidebar collapse
  function toggleSidebar(): void {
    if (sidebarCollapsed) {
      setSidebarCollapsed(false)
      setSidebarWidth(prevWidthRef.current)
    } else {
      prevWidthRef.current = sidebarWidth
      setSidebarCollapsed(true)
    }
  }
  toggleSidebarRef.current = toggleSidebar

  // Cmd/Ctrl+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        if (!(e.target as HTMLElement).closest('.floating-card')) {
          e.preventDefault()
          toggleSidebarRef.current()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sidebar drag-to-resize
  function handleSidebarResizeStart(e: React.MouseEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebarCollapsed ? 0 : sidebarWidth

    document.body.classList.add('sidebar-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: MouseEvent): void {
      const w = Math.max(160, Math.min(600, startW + ev.clientX - startX))
      document.documentElement.style.setProperty('--sidebar-width', `${w}px`)
    }

    function onUp(ev: MouseEvent): void {
      document.body.classList.remove('sidebar-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      const finalW = Math.max(160, Math.min(600, startW + ev.clientX - startX))
      setSidebarWidth(finalW)
      if (sidebarCollapsed) setSidebarCollapsed(false)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

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
        <div style={{ color: 'var(--fg-secondary)', fontSize: 'var(--text-lg)' }}>
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
            fontSize: 'var(--text-lg)'
          }}
        >
          Pick a folder
        </button>
      </div>
    )
  }

  // Only render TerminalCanvas once we've attempted to load the saved layout
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
      <div
        className="sidebar-resize-handle"
        onMouseDown={handleSidebarResizeStart}
        onDoubleClick={toggleSidebar}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
      />
      <main style={{ flex: 1, minWidth: 0, height: '100vh' }}>
        <TerminalCanvas savedLayout={savedLayout} />
      </main>
    </div>
  )
}

export default App
