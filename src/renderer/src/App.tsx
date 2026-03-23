import { useEffect, useState, useRef, useCallback } from 'react'
import React from 'react'
import { TerminalCanvas } from './components/TerminalCanvas'
import type { SavedLayoutShape } from './components/TerminalCanvas'
import { EnhancedSidebar } from './components/EnhancedSidebar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { useProjectStore } from './store/projectStore'
import { usePanelStore } from './store/panelStore'
import { useAppearanceStore } from './store/appearanceStore'
import type { AppearanceMode } from './tokens'

function App(): React.JSX.Element {
  const folderPath = useProjectStore((s) => s.folderPath)
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const setAttention = usePanelStore((s) => s.setAttention)
  const clearAttention = usePanelStore((s) => s.clearAttention)

  // Track previous project path to remove hooks on project switch
  const prevFolderRef = useRef<string | null>(null)

  // Use a ref for savedLayout so it's available synchronously when TerminalCanvas mounts.
  // TerminalCanvas reads savedLayout only on its first render via a ref — React state would
  // be too late because Zustand's setFolderPath triggers a synchronous re-render before
  // React flushes its batched state updates.
  const savedLayoutRef = useRef<SavedLayoutShape | null>(null)

  // Sidebar resize/collapse state
  const [sidebarWidth, setSidebarWidth] = useState(300)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const prevWidthRef = useRef(300)
  const toggleSidebarRef = useRef(() => {})

  // Open a project by path: load layout, track in recent, set as current
  const openProject = useCallback(
    async (path: string) => {
      // Remove hooks from previous project
      if (prevFolderRef.current && prevFolderRef.current !== path) {
        void window.electronAPI.hooksRemove(prevFolderRef.current)
      }
      const layout = await window.electronAPI.layoutLoad(path)
      // Set ref BEFORE triggering re-render so TerminalCanvas reads the correct layout on mount
      savedLayoutRef.current = (layout as SavedLayoutShape) ?? null
      setFolderPath(path)
      prevFolderRef.current = path
      // Track in recent projects (non-blocking)
      void window.electronAPI.projectsAdd(path)
      // Load workspace config (expanded dirs, selected file)
      window.electronAPI.workspaceLoad(path).then((wsConfig) => {
        if (wsConfig.expanded_dirs.length > 0) {
          useProjectStore.getState().setExpandedDirs(new Set(wsConfig.expanded_dirs))
        }
      })
      // Inject Claude Code hooks for agent auto-spawn
      void window.electronAPI.hooksInject(path)
    },
    [setFolderPath]
  )

  // Wire attention events: main process -> panelStore badge
  // Wire agent session events: RPC server -> panelStore agentActive indicator
  useEffect(() => {
    const unsubAttention = window.electronAPI.onAttention((data) => setAttention(data.id))
    const unsubPanelFocus = window.electronAPI.onPanelFocus((id) => clearAttention(id))
    const unsubAgentSpawning = window.electronAPI.onAgentSpawning((data) => {
      // Store agent name for the TmuxPaneSidebar to display
      if (data.ptySessionId) {
        usePanelStore.getState().addAgentName(data.ptySessionId, data.agentName)
      }
    })
    const unsubSessionStarted = window.electronAPI.onAgentSessionStarted((data) => {
      if (data.ptySessionId) {
        usePanelStore.getState().setAgentActive(data.ptySessionId, true)
      }
    })
    const unsubSessionEnded = window.electronAPI.onAgentSessionEnded((data) => {
      if (data.ptySessionId) {
        usePanelStore.getState().setAgentActive(data.ptySessionId, false)
      }
    })
    const unsubFileTouched = window.electronAPI.onAgentFileTouched(() => {
      // Future: show file activity indicators
    })
    const unsubFsChanged = window.electronAPI.onFsChanged(() => {
      useProjectStore.getState().bumpFsRefresh()
    })
    const unsubPaneCreate = window.electronAPI.onPaneCreate((data) => {
      useProjectStore.getState().spawnInteractivePane(data)
    })
    const unsubPaneFocus = window.electronAPI.onPaneFocus((data) => {
      usePanelStore.getState().requestFocus(data.sessionId)
    })
    return () => {
      unsubAttention()
      unsubPanelFocus()
      unsubAgentSpawning()
      unsubSessionStarted()
      unsubSessionEnded()
      unsubFileTouched()
      unsubFsChanged()
      unsubPaneCreate()
      unsubPaneFocus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save workspace config (expanded dirs) when they change — debounced
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.expandedDirs !== prev.expandedDirs && state.folderPath) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          window.electronAPI.workspaceSave(state.folderPath!, {
            selected_file: null,
            expanded_dirs: Array.from(state.expandedDirs)
          })
        }, 1000)
      }
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
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

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const meta = e.metaKey || e.ctrlKey
      // Cmd+B toggle sidebar (only when not inside a card)
      if (meta && e.key === 'b') {
        if (!(e.target as HTMLElement).closest('.floating-card')) {
          e.preventDefault()
          toggleSidebarRef.current()
        }
      }
      // Cmd+= / Cmd+- / Cmd+0 — native UI zoom
      if (meta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        window.electronAPI.zoomIn()
      }
      if (meta && e.key === '-') {
        e.preventDefault()
        window.electronAPI.zoomOut()
      }
      if (meta && e.key === '0') {
        e.preventDefault()
        window.electronAPI.zoomReset()
      }
      // Shift+Cmd+F — fullscreen toggle
      if (meta && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        window.electronAPI.fullscreenToggle()
      }
      // Shift+Cmd+T — cycle appearance: dark → light → system
      if (meta && e.shiftKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        const cycle: AppearanceMode[] = ['dark', 'light', 'system']
        const current = useAppearanceStore.getState().mode
        const next = cycle[(cycle.indexOf(current) + 1) % cycle.length]
        useAppearanceStore.getState().setMode(next)
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

  const handlePickFolder = useCallback(async () => {
    const selected = await window.electronAPI.folderOpen()
    if (selected) {
      await openProject(selected)
    }
  }, [openProject])

  if (folderPath === null) {
    return (
      <>
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 38,
            WebkitAppRegion: 'drag',
            zIndex: 9999
          } as React.CSSProperties}
        />
        <WelcomeScreen
          onSelectProject={(path) => void openProject(path)}
          onPickFolder={() => void handlePickFolder()}
        />
      </>
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
      {/* Window drag region — allows moving the window with hiddenInset titlebar */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 38,
          WebkitAppRegion: 'drag',
          zIndex: 9999,
          pointerEvents: 'auto'
        } as React.CSSProperties}
      />
      {!sidebarCollapsed && (
        <>
          <EnhancedSidebar
            folderPath={folderPath}
            onSwitchProject={(path) => void openProject(path)}
            onToggleSidebar={toggleSidebar}
          />
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleSidebarResizeStart}
            onDoubleClick={toggleSidebar}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
          />
        </>
      )}
      <main style={{ flex: 1, minWidth: 0, height: '100vh', position: 'relative' }}>
        {sidebarCollapsed && (
          <button
            className="sidebar-toggle-btn"
            onClick={toggleSidebar}
            aria-label="Show sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
              <line x1="5.5" y1="2" x2="5.5" y2="14" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        )}
        <TerminalCanvas key={folderPath} savedLayout={savedLayoutRef.current} />
      </main>
    </div>
  )
}

export default App
