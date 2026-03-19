import { useState, useRef, useEffect } from 'react'
import { FloatingCard } from './FloatingCard'
import type { CardRect } from './FloatingCard'
import { usePanelStore } from '../store/panelStore'
import { useProjectStore } from '../store/projectStore'
import { scheduleSave } from '../utils/layoutPersistence'

export interface SavedLayoutShape {
  version: number
  panelIds?: string[]
  tree?: unknown
  panels: Array<{ id: string; title: string; color: string }>
  positions?: Record<string, CardRect>
  viewport?: { panX: number; panY: number; zoom: number }
}

interface TerminalCanvasProps {
  savedLayout?: SavedLayoutShape | null
}

const DEFAULT_W = 480
const DEFAULT_H = 320
const CASCADE_OFFSET = 30
const MIN_ZOOM = 0.15
const MAX_ZOOM = 3.0
const GRID_CELL = 24
const GRID_MAJOR = 5
const EDGE_INSET = 12

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

function normalizeZIndices(positions: Record<string, CardRect>): Record<string, CardRect> {
  const entries = Object.entries(positions).sort(([, a], [, b]) => a.z - b.z)
  const result: Record<string, CardRect> = {}
  entries.forEach(([id, rect], i) => {
    result[id] = { ...rect, z: i + 1 }
  })
  return result
}

function snapToGrid(v: number): number {
  return Math.round(v / GRID_CELL) * GRID_CELL
}

function buildLayoutSnapshot(
  panelIds: string[],
  positions: Record<string, CardRect>,
  viewport: { panX: number; panY: number; zoom: number }
): SavedLayoutShape {
  const allPanels = usePanelStore.getState().panels
  const panels = panelIds
    .filter((id) => allPanels[id])
    .map((id) => ({
      id,
      title: allPanels[id].title,
      color: allPanels[id].color
    }))
  return { version: 3, panelIds, panels, positions: normalizeZIndices(positions), viewport }
}

function computeInitialState(
  savedLayout: SavedLayoutShape | null | undefined,
  fallbackId: string
): { ids: string[]; positions: Record<string, CardRect> } {
  if (savedLayout != null && savedLayout.panels.length > 0) {
    let ids: string[]
    if (savedLayout.panelIds) {
      ids = savedLayout.panelIds
    } else if (savedLayout.tree) {
      const leafIds = extractLeafIds(savedLayout.tree)
      ids = leafIds.length > 0 ? leafIds : savedLayout.panels.map((p) => p.id)
    } else {
      ids = savedLayout.panels.map((p) => p.id)
    }

    const positions: Record<string, CardRect> = {}
    ids.forEach((id, i) => {
      if (savedLayout.positions && savedLayout.positions[id]) {
        positions[id] = savedLayout.positions[id]
      } else {
        positions[id] = {
          x: 40 + i * CASCADE_OFFSET,
          y: 40 + i * CASCADE_OFFSET,
          w: DEFAULT_W,
          h: DEFAULT_H,
          z: i + 1
        }
      }
    })

    return { ids, positions }
  }

  return {
    ids: [fallbackId],
    positions: {
      [fallbackId]: { x: 40, y: 40, w: DEFAULT_W, h: DEFAULT_H, z: 1 }
    }
  }
}

export function TerminalCanvas({ savedLayout }: TerminalCanvasProps): React.JSX.Element {
  const addPanel = usePanelStore((s) => s.addPanel)
  const removePanel = usePanelStore((s) => s.removePanel)
  const folderPath = useProjectStore((s) => s.folderPath)

  const initialIdRef = useRef<string>(crypto.randomUUID())

  const initRef = useRef<ReturnType<typeof computeInitialState> | null>(null)
  if (initRef.current === null) {
    initRef.current = computeInitialState(savedLayout, initialIdRef.current)
  }

  const [panelIds, setPanelIds] = useState<string[]>(initRef.current.ids)
  const [positions, setPositions] = useState<Record<string, CardRect>>(initRef.current.positions)

  const panelIdsRef = useRef(panelIds)
  const positionsRef = useRef(positions)
  const folderPathRef = useRef(folderPath)
  const topZRef = useRef(
    Math.max(...Object.values(initRef.current.positions).map((r) => r.z), 0)
  )

  // Viewport state (refs for perf during continuous pan/zoom)
  const canvasXRef = useRef(savedLayout?.viewport?.panX ?? 0)
  const canvasYRef = useRef(savedLayout?.viewport?.panY ?? 0)
  const scaleRef = useRef(savedLayout?.viewport?.zoom ?? 1)

  const [zoomDisplay, setZoomDisplay] = useState(
    Math.round((savedLayout?.viewport?.zoom ?? 1) * 100)
  )

  // DOM refs
  const viewportRef = useRef<HTMLDivElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const tileLayerRef = useRef<HTMLDivElement>(null)
  const edgeIndicatorsRef = useRef<HTMLDivElement>(null)
  const zoomIndicatorRef = useRef<HTMLDivElement>(null)

  // Edge dot tracking (component-level so handleClosePanel can clean up)
  const edgeDotMapRef = useRef(new Map<string, HTMLDivElement>())
  const edgeDotFadeOutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Expose updateCanvas to call from outside the main effect
  const updateCanvasRef = useRef<() => void>(() => { })

  // Keep refs in sync
  useEffect(() => {
    panelIdsRef.current = panelIds
  }, [panelIds])
  useEffect(() => {
    positionsRef.current = positions
  }, [positions])
  useEffect(() => {
    folderPathRef.current = folderPath
  }, [folderPath])

  // === Main viewport effect: grid, pan, zoom, edge indicators, keyboard ===
  useEffect(() => {
    const viewport = viewportRef.current
    const gridCanvas = gridCanvasRef.current
    const tileLayer = tileLayerRef.current
    const edgeContainer = edgeIndicatorsRef.current
    const zoomIndicator = zoomIndicatorRef.current
    if (!viewport || !gridCanvas || !tileLayer || !edgeContainer || !zoomIndicator) return

    const ctx = gridCanvas.getContext('2d')!
    let zoomTimer: ReturnType<typeof setTimeout> | undefined
    let viewportSaveTimer: ReturnType<typeof setTimeout> | undefined
    let panAnimRaf: number | undefined
    let spaceHeld = false
    let isPanning = false
    const dotMap = edgeDotMapRef.current
    const dotFadeOuts = edgeDotFadeOutsRef.current

    // --- Grid drawing (HTML Canvas 2D, retina-aware) ---
    function drawGrid(): void {
      const w = viewport.clientWidth
      const h = viewport.clientHeight
      const dpr = window.devicePixelRatio || 1
      gridCanvas.width = w * dpr
      gridCanvas.height = h * dpr
      gridCanvas.style.width = `${w}px`
      gridCanvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const scale = scaleRef.current
      const panX = canvasXRef.current
      const panY = canvasYRef.current
      const step = GRID_CELL * scale

      if (step < 4) return // too dense at this zoom

      const offX = ((panX % step) + step) % step
      const offY = ((panY % step) + step) % step
      const majorStep = step * GRID_MAJOR
      const majorOffX = ((panX % majorStep) + majorStep) % majorStep
      const majorOffY = ((panY % majorStep) + majorStep) % majorStep

      // Minor dots
      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      const ds = Math.max(1, 1.5 * scale)
      for (let x = offX; x < w; x += step) {
        for (let y = offY; y < h; y += step) {
          ctx.fillRect(x - ds / 2, y - ds / 2, ds, ds)
        }
      }

      // Major dots
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      const mds = Math.max(1.5, 2.5 * scale)
      for (let x = majorOffX; x < w; x += majorStep) {
        for (let y = majorOffY; y < h; y += majorStep) {
          ctx.fillRect(x - mds / 2, y - mds / 2, mds, mds)
        }
      }
    }

    // --- Edge indicators for off-screen tiles ---
    function updateEdgeIndicators(): void {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      const vcx = vw / 2
      const vcy = vh / 2
      const scale = scaleRef.current
      const panX = canvasXRef.current
      const panY = canvasYRef.current
      const pos = positionsRef.current
      const ids = panelIdsRef.current
      const activeIds = new Set<string>()

      for (const id of ids) {
        const r = pos[id]
        if (!r) continue

        // Tile bounds in screen-space
        const sl = r.x * scale + panX
        const st = r.y * scale + panY
        const sr = sl + r.w * scale
        const sb = st + r.h * scale

        // Skip if tile is at least partially visible
        if (!(sr <= 0 || sl >= vw || sb <= 0 || st >= vh)) continue
        activeIds.add(id)

        // Tile center in screen-space
        const tcx = (r.x + r.w / 2) * scale + panX
        const tcy = (r.y + r.h / 2) * scale + panY
        const dx = tcx - vcx
        const dy = tcy - vcy

        // Ray-rect intersection to find edge position
        let tMin = Infinity
        let dotX = vcx
        let dotY = vcy
        const check = (t: number, x: number, y: number): void => {
          if (t > 0 && t < tMin) {
            tMin = t
            dotX = x
            dotY = y
          }
        }

        if (dx < 0) {
          const t = -vcx / dx
          check(t, EDGE_INSET, vcy + t * dy)
        }
        if (dx > 0) {
          const t = (vw - vcx) / dx
          check(t, vw - EDGE_INSET, vcy + t * dy)
        }
        if (dy < 0) {
          const t = -vcy / dy
          check(t, vcx + t * dx, EDGE_INSET)
        }
        if (dy > 0) {
          const t = (vh - vcy) / dy
          check(t, vcx + t * dx, vh - EDGE_INSET)
        }

        dotX = Math.max(EDGE_INSET, Math.min(dotX, vw - EDGE_INSET))
        dotY = Math.max(EDGE_INSET, Math.min(dotY, vh - EDGE_INSET))

        let dot = dotMap.get(id)
        if (!dot) {
          dot = document.createElement('div')
          dot.className = 'edge-dot'
          dot.dataset.tileId = id
          edgeContainer.appendChild(dot)
          dotMap.set(id, dot)
          requestAnimationFrame(() => dot!.classList.add('visible'))
        } else {
          const timer = dotFadeOuts.get(id)
          if (timer != null) {
            clearTimeout(timer)
            dotFadeOuts.delete(id)
            dot.classList.add('visible')
          }
        }
        dot.style.left = `${dotX}px`
        dot.style.top = `${dotY}px`
      }

      // Fade out dots for tiles that are now visible
      for (const [id, dot] of dotMap) {
        if (activeIds.has(id) || dotFadeOuts.has(id)) continue
        dot.classList.remove('visible')
        dotFadeOuts.set(
          id,
          setTimeout(() => {
            dot.remove()
            dotMap.delete(id)
            dotFadeOuts.delete(id)
          }, 200)
        )
      }
    }

    // --- Core update: tile-layer transform + grid + edge indicators ---
    function updateCanvas(): void {
      tileLayer.style.transform =
        `translate(${canvasXRef.current}px,${canvasYRef.current}px) scale(${scaleRef.current})`
      drawGrid()
      updateEdgeIndicators()
    }

    updateCanvasRef.current = updateCanvas

    // --- Zoom indicator badge ---
    function showZoomIndicator(): void {
      const pct = Math.round(scaleRef.current * 100)
      zoomIndicator.textContent = `${pct}%`
      zoomIndicator.classList.add('visible')
      clearTimeout(zoomTimer)
      zoomTimer = setTimeout(() => {
        zoomIndicator.classList.remove('visible')
        setZoomDisplay(pct)
      }, 1500)
    }

    // --- Debounced viewport save ---
    function scheduleViewportSave(): void {
      clearTimeout(viewportSaveTimer)
      viewportSaveTimer = setTimeout(() => {
        const fp = folderPathRef.current
        if (!fp) return
        scheduleSave(
          fp,
          buildLayoutSnapshot(panelIdsRef.current, positionsRef.current, {
            panX: canvasXRef.current,
            panY: canvasYRef.current,
            zoom: scaleRef.current
          })
        )
      }, 2000)
    }

    // --- Focal-point zoom ---
    function applyZoom(factor: number, focalX: number, focalY: number): void {
      const prev = scaleRef.current
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor))
      if (next === prev) return
      scaleRef.current = next
      const ratio = next / prev - 1
      canvasXRef.current -= (focalX - canvasXRef.current) * ratio
      canvasYRef.current -= (focalY - canvasYRef.current) * ratio
      updateCanvas()
      showZoomIndicator()
      scheduleViewportSave()
    }

    // --- Animated pan to a tile (easeOut cubic) ---
    function panToTile(id: string): void {
      const r = positionsRef.current[id]
      if (!r) return
      if (panAnimRaf) cancelAnimationFrame(panAnimRaf)

      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      const scale = scaleRef.current
      const targetX = vw / 2 - (r.x + r.w / 2) * scale
      const targetY = vh / 2 - (r.y + r.h / 2) * scale
      const startX = canvasXRef.current
      const startY = canvasYRef.current
      const startTime = performance.now()

      function step(now: number): void {
        const t = Math.min((now - startTime) / 350, 1)
        const e = 1 - Math.pow(1 - t, 3) // easeOutCubic
        canvasXRef.current = startX + (targetX - startX) * e
        canvasYRef.current = startY + (targetY - startY) * e
        updateCanvas()
        if (t < 1) {
          panAnimRaf = requestAnimationFrame(step)
        } else {
          panAnimRaf = undefined
          scheduleViewportSave()
        }
      }

      panAnimRaf = requestAnimationFrame(step)
    }

    // --- Wheel: pan + zoom ---
    function handleWheel(e: WheelEvent): void {
      if (e.ctrlKey || e.metaKey) {
        // Zoom (trackpad pinch or Ctrl+scroll)
        e.preventDefault()
        const rect = viewport.getBoundingClientRect()
        const factor = Math.exp(-e.deltaY * 0.006)
        applyZoom(factor, e.clientX - rect.left, e.clientY - rect.top)
      } else if (!(e.target as HTMLElement).closest('.floating-card')) {
        // Pan on empty canvas (let cards handle their own scroll)
        e.preventDefault()
        canvasXRef.current -= e.deltaX * 1.2
        canvasYRef.current -= e.deltaY * 1.2
        updateCanvas()
        scheduleViewportSave()
      }
    }

    // --- Middle-click drag & Space+left-click drag to pan ---
    function handleMouseDown(e: MouseEvent): void {
      const shouldPan = e.button === 1 || (e.button === 0 && spaceHeld)
      if (!shouldPan) return

      e.preventDefault()
      isPanning = true
      viewport.classList.add('panning')
      document.body.classList.add('canvas-interacting')

      const startMX = e.clientX
      const startMY = e.clientY
      const startPanX = canvasXRef.current
      const startPanY = canvasYRef.current

      function onMove(ev: MouseEvent): void {
        canvasXRef.current = startPanX + (ev.clientX - startMX)
        canvasYRef.current = startPanY + (ev.clientY - startMY)
        updateCanvas()
      }

      function onUp(): void {
        isPanning = false
        viewport.classList.remove('panning')
        document.body.classList.remove('canvas-interacting')
        if (!spaceHeld) viewport.classList.remove('space-held')
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        scheduleViewportSave()
      }

      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    // --- Edge indicator click (event delegation) ---
    function handleEdgeClick(e: MouseEvent): void {
      const dot = (e.target as HTMLElement).closest('.edge-dot') as HTMLElement | null
      if (dot?.dataset.tileId) panToTile(dot.dataset.tileId)
    }

    // --- Keyboard shortcuts ---
    function handleKeyDown(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Space to enter pan mode (only when focus is outside a terminal card)
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('.floating-card')) {
        e.preventDefault()
        if (!e.repeat && !spaceHeld) {
          spaceHeld = true
          viewport.classList.add('space-held')
          // Blur focused terminal so space doesn't type into it
          const active = document.activeElement as HTMLElement | null
          if (active?.closest?.('.floating-card')) active.blur()
        }
        return
      }

      if ((e.target as HTMLElement).closest('.floating-card')) return

      if (e.key === '0' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Reset zoom to 100%, centered
        const prev = scaleRef.current
        if (prev === 1) return
        scaleRef.current = 1
        const vw = viewport.clientWidth
        const vh = viewport.clientHeight
        const ratio = 1 / prev - 1
        canvasXRef.current -= (vw / 2 - canvasXRef.current) * ratio
        canvasYRef.current -= (vh / 2 - canvasYRef.current) * ratio
        updateCanvas()
        showZoomIndicator()
        scheduleViewportSave()
      }
    }

    function handleKeyUp(e: KeyboardEvent): void {
      if (e.code === 'Space') {
        spaceHeld = false
        if (!isPanning) {
          viewport.classList.remove('space-held')
        }
      }
    }

    // Prevent middle-click auto-scroll on the viewport
    function handleAuxClick(e: MouseEvent): void {
      if (e.button === 1) e.preventDefault()
    }

    // Attach listeners
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    viewport.addEventListener('mousedown', handleMouseDown)
    viewport.addEventListener('auxclick', handleAuxClick)
    edgeContainer.addEventListener('click', handleEdgeClick)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    const ro = new ResizeObserver(() => updateCanvas())
    ro.observe(viewport)

    // Initial draw
    updateCanvas()

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('mousedown', handleMouseDown)
      viewport.removeEventListener('auxclick', handleAuxClick)
      edgeContainer.removeEventListener('click', handleEdgeClick)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      ro.disconnect()
      clearTimeout(zoomTimer)
      clearTimeout(viewportSaveTimer)
      if (panAnimRaf) cancelAnimationFrame(panAnimRaf)
      for (const timer of dotFadeOuts.values()) clearTimeout(timer)
      for (const dot of dotMap.values()) dot.remove()
      dotMap.clear()
      dotFadeOuts.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-run canvas update when positions/panels change (edge indicators)
  useEffect(() => {
    updateCanvasRef.current()
  }, [positions, panelIds])

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

  // Subscribe to panelStore title/color changes -> scheduleSave
  useEffect(() => {
    const unsubscribe = usePanelStore.subscribe((state, prev) => {
      if (state.panels === prev.panels) return
      for (const id of Object.keys(state.panels)) {
        const cur = state.panels[id]
        const prevPanel = prev.panels[id]
        if (prevPanel && (cur.title !== prevPanel.title || cur.color !== prevPanel.color)) {
          if (folderPathRef.current) {
            scheduleSave(
              folderPathRef.current,
              buildLayoutSnapshot(panelIdsRef.current, positionsRef.current, {
                panX: canvasXRef.current,
                panY: canvasYRef.current,
                zoom: scaleRef.current
              })
            )
          }
          return
        }
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Layout persistence helpers ---
  function getViewport(): { panX: number; panY: number; zoom: number } {
    return { panX: canvasXRef.current, panY: canvasYRef.current, zoom: scaleRef.current }
  }

  function triggerSave(ids: string[], pos: Record<string, CardRect>): void {
    if (folderPathRef.current) {
      scheduleSave(folderPathRef.current, buildLayoutSnapshot(ids, pos, getViewport()))
    }
  }

  // --- Card lifecycle ---
  function handleAddPanel(): void {
    const newId = crypto.randomUUID()
    addPanel(newId)

    // Place new card at the center of the current viewport
    const viewport = viewportRef.current
    const scale = scaleRef.current
    let x = 40
    let y = 40

    if (viewport) {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      x = snapToGrid((vw / 2 - canvasXRef.current) / scale - DEFAULT_W / 2)
      y = snapToGrid((vh / 2 - canvasYRef.current) / scale - DEFAULT_H / 2)
    }

    const newZ = ++topZRef.current
    const newRect: CardRect = { x, y, w: DEFAULT_W, h: DEFAULT_H, z: newZ }

    setPanelIds((prev) => {
      const next = [...prev, newId]
      panelIdsRef.current = next
      return next
    })
    setPositions((prev) => {
      const next = { ...prev, [newId]: newRect }
      positionsRef.current = next
      triggerSave([...panelIdsRef.current], next)
      return next
    })
  }

  function handleClosePanel(id: string): void {
    window.electronAPI.ptyKill(id)
    removePanel(id)

    // Clean up edge dot
    const dot = edgeDotMapRef.current.get(id)
    if (dot) {
      dot.remove()
      edgeDotMapRef.current.delete(id)
    }
    const timer = edgeDotFadeOutsRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      edgeDotFadeOutsRef.current.delete(id)
    }

    setPanelIds((prev) => {
      const next = prev.filter((pid) => pid !== id)
      panelIdsRef.current = next
      return next
    })
    setPositions((prev) => {
      const { [id]: _, ...rest } = prev
      positionsRef.current = rest
      triggerSave(panelIdsRef.current, rest)
      return rest
    })
  }

  function handleMove(id: string, x: number, y: number): void {
    setPositions((prev) => {
      const next = { ...prev, [id]: { ...prev[id], x, y } }
      positionsRef.current = next
      triggerSave(panelIdsRef.current, next)
      return next
    })
  }

  function handleResize(id: string, w: number, h: number): void {
    setPositions((prev) => {
      const next = { ...prev, [id]: { ...prev[id], w, h } }
      positionsRef.current = next
      triggerSave(panelIdsRef.current, next)
      return next
    })
  }

  function handleBringToFront(id: string): void {
    const newZ = ++topZRef.current
    setPositions((prev) => {
      const next = { ...prev, [id]: { ...prev[id], z: newZ } }
      positionsRef.current = next
      return next
    })
  }

  return (
    <div className="terminal-canvas">
      <div className="terminal-canvas-toolbar">
        <button onClick={handleAddPanel} className="terminal-canvas-add-btn">
          + New terminal
        </button>
        <span className="terminal-canvas-toolbar-spacer" />
        {zoomDisplay !== 100 && (
          <button
            className="terminal-canvas-zoom-reset"
            onClick={() => {
              const vp = viewportRef.current
              if (!vp) return
              const prev = scaleRef.current
              scaleRef.current = 1
              const vw = vp.clientWidth
              const vh = vp.clientHeight
              const ratio = 1 / prev - 1
              canvasXRef.current -= (vw / 2 - canvasXRef.current) * ratio
              canvasYRef.current -= (vh / 2 - canvasYRef.current) * ratio
              updateCanvasRef.current()
              setZoomDisplay(100)
            }}
          >
            {zoomDisplay}%
          </button>
        )}
      </div>
      <div ref={viewportRef} className="terminal-canvas-viewport">
        <canvas ref={gridCanvasRef} className="terminal-canvas-grid" />
        <div
          ref={tileLayerRef}
          className="terminal-canvas-tile-layer"
          style={{ transformOrigin: '0 0' }}
        >
          {panelIds.map((id) => {
            const rect = positions[id]
            if (!rect) return null
            return (
              <FloatingCard
                key={id}
                sessionId={id}
                cwd={folderPath ?? '.'}
                rect={rect}
                zoomRef={scaleRef}
                onMove={handleMove}
                onResize={handleResize}
                onBringToFront={handleBringToFront}
                onClose={handleClosePanel}
              />
            )
          })}
        </div>
        <div ref={edgeIndicatorsRef} className="terminal-canvas-edge-indicators" />
        <div ref={zoomIndicatorRef} className="terminal-canvas-zoom-indicator" />
        {panelIds.length === 0 && (
          <div className="terminal-canvas-empty-overlay">
            <div className="terminal-canvas-empty">
              <div className="terminal-canvas-empty-ghost">
                <div className="terminal-canvas-empty-ghost-header" />
                <div className="terminal-canvas-empty-ghost-body" />
              </div>
              <p className="terminal-canvas-empty-text">
                Click <strong>+ New terminal</strong> to get started
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
