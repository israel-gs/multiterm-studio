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
  const folderPaths = useProjectStore((s) => s.folderPaths)
  const workspaceFilePath = useProjectStore((s) => s.workspaceFilePath)
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const setAttention = usePanelStore((s) => s.setAttention)
  const clearAttention = usePanelStore((s) => s.clearAttention)

  // Track previous folders for hook cleanup
  const prevFolderPathsRef = useRef<string[]>([])

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

  // Open a single project by path: load layout, track in recent, set as current
  const openProject = useCallback(
    async (path: string) => {
      // Remove hooks from all previous folders
      if (prevFolderPathsRef.current.length > 0) {
        void window.electronAPI.hooksRemoveAll(prevFolderPathsRef.current)
      }
      const layout = await window.electronAPI.layoutLoad(path)
      savedLayoutRef.current = (layout as SavedLayoutShape) ?? null
      setFolderPath(path)
      prevFolderPathsRef.current = [path]
      void window.electronAPI.projectsAdd(path)
      window.electronAPI.workspaceLoad(path).then((wsConfig) => {
        if (wsConfig.expanded_dirs.length > 0) {
          useProjectStore.getState().setExpandedDirs(new Set(wsConfig.expanded_dirs))
        }
      })
      void window.electronAPI.hooksInject(path)
    },
    [setFolderPath]
  )

  // Open a workspace file: restore all folders + layout + expanded dirs
  const openWorkspace = useCallback(
    async (filePath: string) => {
      if (prevFolderPathsRef.current.length > 0) {
        void window.electronAPI.hooksRemoveAll(prevFolderPathsRef.current)
      }
      const ws = await window.electronAPI.workspaceFileLoad(filePath) as {
        version: number
        folders: Array<{ path: string }>
        layout: SavedLayoutShape | null
        expandedDirs: Record<string, string[]>
      } | null
      if (!ws || ws.folders.length === 0) return

      const paths = ws.folders.map((f) => f.path)
      savedLayoutRef.current = ws.layout ?? null

      // Merge all expanded dirs
      const allExpanded = new Set<string>()
      for (const dirs of Object.values(ws.expandedDirs ?? {})) {
        for (const d of dirs) allExpanded.add(d)
      }

      const store = useProjectStore.getState()
      store.setFolderPaths(paths)
      store.setWorkspaceFilePath(filePath)
      store.setExpandedDirs(allExpanded)
      prevFolderPathsRef.current = paths

      void window.electronAPI.projectsAdd(filePath, {
        type: 'workspace',
        folderNames: paths.map((p) => p.split('/').pop() ?? p)
      })
      void window.electronAPI.hooksInjectAll(paths)
    },
    []
  )

  // Add a folder to the current workspace
  const addFolderToWorkspace = useCallback(async () => {
    const selected = await window.electronAPI.folderOpen()
    if (!selected) return
    const store = useProjectStore.getState()
    if (store.folderPaths.includes(selected)) return
    store.addFolderPath(selected)
    prevFolderPathsRef.current = store.folderPaths
    void window.electronAPI.hooksInjectAll(store.folderPaths)
  }, [])

  // Remove a folder from the current workspace
  const removeFolderFromWorkspace = useCallback((path: string) => {
    const store = useProjectStore.getState()
    void window.electronAPI.hooksRemove(path)
    store.removeFolderPath(path)
    prevFolderPathsRef.current = store.folderPaths
    if (store.folderPaths.length > 0) {
      void window.electronAPI.hooksInjectAll(store.folderPaths)
    }
  }, [])

  // Save current state as a workspace file
  const saveWorkspace = useCallback(async () => {
    const filePath = await window.electronAPI.workspaceFileSaveDialog()
    if (!filePath) return
    const store = useProjectStore.getState()
    const expandedDirs: Record<string, string[]> = {}
    const allExpanded = Array.from(store.expandedDirs)
    for (const fp of store.folderPaths) {
      expandedDirs[fp] = allExpanded.filter((d) => d.startsWith(fp))
    }
    await window.electronAPI.workspaceFileSave(filePath, {
      version: 1,
      folders: store.folderPaths.map((p) => ({ path: p })),
      layout: savedLayoutRef.current,
      expandedDirs
    })
    store.setWorkspaceFilePath(filePath)
    void window.electronAPI.projectsAdd(filePath, {
      type: 'workspace',
      folderNames: store.folderPaths.map((p) => p.split('/').pop() ?? p)
    })
  }, [])

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

  // Save expanded dirs when they change — to workspace file or per-folder config
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.expandedDirs !== prev.expandedDirs && state.folderPaths.length > 0) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (state.workspaceFilePath) {
            // Workspace mode: save into workspace file (layout:save-workspace handles it)
            // expandedDirs are saved alongside layout on each layout save
          } else if (state.folderPath) {
            // Single-folder mode: save to per-folder workspace config
            window.electronAPI.workspaceSave(state.folderPath, {
              selected_file: null,
              expanded_dirs: Array.from(state.expandedDirs)
            })
          }
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

  // Menu bar actions for app-level features
  useEffect(() => {
    const unsub = window.electronAPI.onMenuAction((action) => {
      if (action === 'toggle-sidebar') toggleSidebarRef.current()
      else if (action === 'add-folder') void addFolderToWorkspace()
      else if (action === 'save-workspace') void saveWorkspace()
      else if (action === 'open-workspace') {
        window.electronAPI.workspaceFileOpenDialog().then((fp) => {
          if (fp) void openWorkspace(fp)
        })
      }
    })
    return unsub
  }, [addFolderToWorkspace, saveWorkspace, openWorkspace])

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
          onSelectProject={(path) => {
            if (path.endsWith('.multiterm-workspace') || path.endsWith('.code-workspace')) {
              void openWorkspace(path)
            } else {
              void openProject(path)
            }
          }}
          onPickFolder={() => void handlePickFolder()}
          onOpenWorkspace={() => {
            window.electronAPI.workspaceFileOpenDialog().then((fp) => {
              if (fp) void openWorkspace(fp)
            })
          }}
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
            folderPaths={folderPaths}
            onSwitchProject={(path) => void openProject(path)}
            onAddFolder={addFolderToWorkspace}
            onRemoveFolder={removeFolderFromWorkspace}
            onSaveWorkspace={saveWorkspace}
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
        <TerminalCanvas key={workspaceFilePath ?? folderPath} savedLayout={savedLayoutRef.current} />
      </main>
    </div>
  )
}

export default App
