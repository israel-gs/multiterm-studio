import { useEffect, useState, useRef, useCallback } from 'react'
import React from 'react'
import { PanelRight } from 'lucide-react'
import { TerminalCanvas } from './components/TerminalCanvas'
import type { SavedLayoutShape } from './components/TerminalCanvas'
import { EnhancedSidebar } from './components/EnhancedSidebar'
import { TileIndexSidebar } from './components/TileIndexSidebar'
import { WelcomeScreen } from './components/WelcomeScreen'
import { ErrorToasts } from './components/ErrorToasts'
import { useProjectStore } from './store/projectStore'
import { usePanelStore } from './store/panelStore'
import { flushSave } from './utils/layoutPersistence'
import { useAppearanceStore } from './store/appearanceStore'
import type { AppearanceMode } from './tokens'
import { basename } from './utils/path'

/** Bounds and default for the tile index width, matching the left sidebar's feel. */
const TILE_INDEX_DEFAULT_WIDTH = 260
const TILE_INDEX_MIN_WIDTH = 180
const TILE_INDEX_MAX_WIDTH = 480

function clampTileIndexWidth(width: number): number {
  return Math.max(TILE_INDEX_MIN_WIDTH, Math.min(TILE_INDEX_MAX_WIDTH, Math.round(width)))
}

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

  // Tile index (right sidebar). Width and collapse live in app settings rather
  // than the per-project layout file: it is window chrome, not part of a
  // project's tile arrangement.
  const [indexWidth, setIndexWidth] = useState(TILE_INDEX_DEFAULT_WIDTH)
  const [indexCollapsed, setIndexCollapsed] = useState(false)
  const toggleTileIndexRef = useRef(() => {})

  /**
   * Tears down the project that is currently open before another one replaces it.
   *
   * TerminalCanvas is remounted via `key`, and TerminalPanel deliberately does
   * not kill its PTY on unmount (tile close owns that), so without this every
   * project switch would strand its shells in the sidecar for the rest of the
   * run and leave the previous project's panels in the store.
   *
   * Note this means terminals do not survive a project switch — reopening the
   * project starts fresh shells.
   */
  const closeCurrentProject = useCallback(async () => {
    if (prevFolderPathsRef.current.length > 0) {
      void window.electronAPI.hooksRemoveAll(prevFolderPathsRef.current)
    }

    // Persist whatever the debounce timer was still holding on to.
    await flushSave().catch(() => {
      /* a failed save must not block the switch */
    })

    const panels = usePanelStore.getState().panels
    await Promise.all(
      Object.entries(panels)
        .filter(([, meta]) => meta.type === 'terminal')
        .map(([id]) =>
          window.electronAPI.ptyKill(id).catch(() => {
            /* already gone */
          })
        )
    )
    usePanelStore.getState().reset()
  }, [])

  // Open a single project by path: load layout, track in recent, set as current
  const openProject = useCallback(
    async (path: string) => {
      await closeCurrentProject()
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
    [setFolderPath, closeCurrentProject]
  )

  // Open a workspace file: restore all folders + layout + expanded dirs
  const openWorkspace = useCallback(
    async (filePath: string) => {
      await closeCurrentProject()
      const ws = (await window.electronAPI.workspaceFileLoad(filePath)) as {
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
        folderNames: paths.map((p) => basename(p) || p)
      })
      void window.electronAPI.hooksInjectAll(paths)
    },
    [closeCurrentProject]
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
      folderNames: store.folderPaths.map((p) => basename(p) || p)
    })
  }, [])

  // Wire attention events: main process -> panelStore badge
  // Wire agent session events: RPC server -> panelStore agentActive indicator
  useEffect(() => {
    const unsubAttention = window.electronAPI.onAttention((data) => setAttention(data.id))
    const unsubPanelFocus = window.electronAPI.onPanelFocus((id) => clearAttention(id))
    // A subagent starting up gets its own tile tailing that agent's transcript.
    const unsubAgentSpawning = window.electronAPI.onAgentSpawning((data) => {
      // viewerPath comes from the hook script that Claude Code ran; without it
      // there is nothing to tail.
      if (!data.viewerPath) return
      useProjectStore.getState().spawnAgentTerminal({
        agentName: data.agentName,
        toolUseId: data.toolUseId,
        subagentsDir: data.subagentsDir,
        cwd: data.cwd,
        viewerPath: data.viewerPath
      })
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

  // Tell the main process which folders local-resource:// may serve from.
  // Without this the protocol would happily read any file on the machine.
  useEffect(() => {
    window.electronAPI.workspaceSetRoots(folderPaths)
  }, [folderPaths])

  // Open whatever the app was launched with: `multiterm <dir>` from the CLI, a
  // double-clicked workspace file, or a second `multiterm` invocation.
  useEffect(() => {
    const open = (path: string): void => {
      if (path.endsWith('.multiterm-workspace') || path.endsWith('.code-workspace')) {
        void openWorkspace(path)
      } else {
        void openProject(path)
      }
    }

    // The path may have arrived before this listener existed — claim it first.
    void window.electronAPI.appTakeOpenPath().then((path) => {
      if (path) open(path)
    })

    return window.electronAPI.onOpenPath(open)
  }, [openProject, openWorkspace])

  // Sync sidebar width to CSS custom property (drives .enhanced-sidebar width)
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      `${sidebarCollapsed ? 0 : sidebarWidth}px`
    )
  }, [sidebarWidth, sidebarCollapsed])

  // Same for the tile index on the right
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--tile-index-width',
      `${indexCollapsed ? 0 : indexWidth}px`
    )
  }, [indexWidth, indexCollapsed])

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
      // UI zoom is not handled here: the View menu's zoom roles let Chromium
      // register the platform's own accelerators, which cover the key variants
      // a non-US keyboard layout produces.
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
  }, [])

  // Menu bar actions for app-level features
  useEffect(() => {
    const unsub = window.electronAPI.onMenuAction((action) => {
      if (action === 'toggle-sidebar') toggleSidebarRef.current()
      else if (action === 'toggle-tile-index') toggleTileIndexRef.current()
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

  useEffect(() => {
    void Promise.all([
      window.electronAPI.settingsGet('ui.tileIndex.width'),
      window.electronAPI.settingsGet('ui.tileIndex.collapsed')
    ]).then(([width, collapsed]) => {
      if (typeof width === 'number') setIndexWidth(clampTileIndexWidth(width))
      if (typeof collapsed === 'boolean') setIndexCollapsed(collapsed)
    })
  }, [])

  const toggleTileIndex = useCallback(() => {
    setIndexCollapsed((prev) => {
      const next = !prev
      window.electronAPI.settingsSet('ui.tileIndex.collapsed', next)
      return next
    })
  }, [])
  toggleTileIndexRef.current = toggleTileIndex

  // Tile index drag-to-resize. It grows leftwards, so the delta is inverted.
  function handleIndexResizeStart(e: React.MouseEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startW = indexCollapsed ? 0 : indexWidth

    document.body.classList.add('sidebar-resizing')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function widthAt(clientX: number): number {
      return clampTileIndexWidth(startW + startX - clientX)
    }

    function onMove(ev: MouseEvent): void {
      document.documentElement.style.setProperty('--tile-index-width', `${widthAt(ev.clientX)}px`)
    }

    function onUp(ev: MouseEvent): void {
      document.body.classList.remove('sidebar-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      const finalW = widthAt(ev.clientX)
      setIndexWidth(finalW)
      window.electronAPI.settingsSet('ui.tileIndex.width', finalW)
      if (indexCollapsed) {
        setIndexCollapsed(false)
        window.electronAPI.settingsSet('ui.tileIndex.collapsed', false)
      }
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

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
          style={
            {
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              height: 38,
              WebkitAppRegion: 'drag',
              zIndex: 9999
            } as React.CSSProperties
          }
        />
        <ErrorToasts />
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
        style={
          {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            height: 38,
            WebkitAppRegion: 'drag',
            zIndex: 9999,
            pointerEvents: 'auto'
          } as React.CSSProperties
        }
      />
      {/* Sidebar stays mounted to preserve FileTree state — hidden via CSS when collapsed */}
      <div className={`sidebar-mount${sidebarCollapsed ? ' sidebar-mount--hidden' : ''}`}>
        <EnhancedSidebar
          folderPath={folderPath}
          folderPaths={folderPaths}
          onSwitchProject={(path) => void openProject(path)}
          onOpenWorkspace={(path) => void openWorkspace(path)}
          onOpenWorkspaceDialog={() => {
            window.electronAPI.workspaceFileOpenDialog().then((fp) => {
              if (fp) void openWorkspace(fp)
            })
          }}
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
      </div>
      <main style={{ flex: 1, minWidth: 0, height: '100vh', position: 'relative' }}>
        {sidebarCollapsed && (
          <button className="sidebar-toggle-btn" onClick={toggleSidebar} aria-label="Show sidebar">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="1"
                y="2"
                width="14"
                height="12"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <line x1="5.5" y1="2" x2="5.5" y2="14" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        )}
        {indexCollapsed && (
          <button
            className="sidebar-toggle-btn tile-index-show-btn"
            onClick={toggleTileIndex}
            aria-label="Show tile index"
            title="Show tile index"
          >
            <PanelRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
        <TerminalCanvas
          key={workspaceFilePath ?? folderPath}
          savedLayout={savedLayoutRef.current}
        />
      </main>
      {/* Tile index stays mounted so its scroll position survives collapsing */}
      <div className={`tile-index-mount${indexCollapsed ? ' tile-index-mount--hidden' : ''}`}>
        <div
          className="tile-index-resize-handle"
          onMouseDown={handleIndexResizeStart}
          onDoubleClick={toggleTileIndex}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize tile index"
        />
        <TileIndexSidebar onToggle={toggleTileIndex} />
      </div>
      <ErrorToasts />
    </div>
  )
}

export default App
