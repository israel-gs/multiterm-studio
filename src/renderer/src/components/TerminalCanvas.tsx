import { useState, useRef, useEffect } from 'react'
import { FloatingCard } from './FloatingCard'
import type { CardRect } from './FloatingCard'
import { CanvasContextMenu } from './CanvasContextMenu'
import { PanelModal } from './PanelModal'
import { usePanelStore } from '../store/panelStore'
import { useProjectStore } from '../store/projectStore'
import type { AgentSpawnRequest } from '../store/projectStore'
import { scheduleSave } from '../utils/layoutPersistence'
import { colors } from '../tokens'

export interface SavedLayoutShape {
  version: number
  panelIds?: string[]
  tree?: unknown
  panels: Array<{ id: string; title: string; color: string; type?: 'terminal' | 'editor'; filePath?: string }>
  positions?: Record<string, CardRect>
  viewport?: { panX: number; panY: number; zoom: number }
}

interface TerminalCanvasProps {
  savedLayout?: SavedLayoutShape | null
}

interface ContextMenuState {
  x: number
  y: number
  type: 'canvas' | 'card'
  cardId?: string
  cardType?: 'terminal' | 'editor'
}

const DEFAULT_W = 480
const DEFAULT_H = 320
const CASCADE_OFFSET = 30
const MIN_ZOOM = 0.15
const MAX_ZOOM = 3.0
const GRID_CELL = 24
const GRID_MAJOR = 5
const EDGE_INSET = 12
const MARQUEE_THRESHOLD = 3

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
      color: allPanels[id].color,
      type: allPanels[id].type,
      filePath: allPanels[id].filePath
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
  const panels = usePanelStore((s) => s.panels)
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


  // DOM refs
  const viewportRef = useRef<HTMLDivElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const tileLayerRef = useRef<HTMLDivElement>(null)
  const edgeIndicatorsRef = useRef<HTMLDivElement>(null)
  const zoomIndicatorRef = useRef<HTMLDivElement>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null)
  const minimapTransformRef = useRef<{
    minX: number; minY: number; mScale: number; offsetX: number; offsetY: number
  } | null>(null)

  // Edge dot tracking (component-level so handleClosePanel can clean up)
  const edgeDotMapRef = useRef(new Map<string, HTMLDivElement>())
  const edgeDotFadeOutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Expose updateCanvas to call from outside the main effect
  const updateCanvasRef = useRef<() => void>(() => { })

  // Selection state
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [modal, setModal] = useState<{ type: 'rename' | 'color'; cardId: string } | null>(null)

  // Refs for accessing component-level functions from the main effect
  const handleAddPanelAtRef = useRef<(x: number, y: number) => void>(() => { })
  const handleClosePanelRef = useRef<(id: string) => void>(() => { })

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

  // === Main viewport effect: grid, pan, zoom, edge indicators, keyboard, selection, marquee ===
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
    let snapBackTimer: ReturnType<typeof setTimeout> | undefined
    let snapBackRaf: number | undefined
    let spaceHeld = false
    let isPanning = false
    let lastPanEndTime = 0
    let marqueeDidDrag = false
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

    // --- Minimap ---
    const minimapCanvas = minimapCanvasRef.current
    const MM_W = 160
    const MM_H = 100

    function drawMinimap(): void {
      if (!minimapCanvas) return
      const ids = panelIdsRef.current
      const pos = positionsRef.current

      if (ids.length === 0) {
        minimapCanvas.style.opacity = '0'
        return
      }
      minimapCanvas.style.opacity = '1'

      const dpr = window.devicePixelRatio || 1
      minimapCanvas.width = MM_W * dpr
      minimapCanvas.height = MM_H * dpr
      minimapCanvas.style.width = `${MM_W}px`
      minimapCanvas.style.height = `${MM_H}px`

      const mctx = minimapCanvas.getContext('2d')!
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const scale = scaleRef.current
      const panX = canvasXRef.current
      const panY = canvasYRef.current
      const vpW = viewport.clientWidth
      const vpH = viewport.clientHeight

      // Viewport rect in world coords
      const vpWX = -panX / scale
      const vpWY = -panY / scale
      const vpWW = vpW / scale
      const vpWH = vpH / scale

      // Compute world bounds (all cards + viewport)
      let minX = vpWX, minY = vpWY, maxX = vpWX + vpWW, maxY = vpWY + vpWH
      for (const id of ids) {
        const r = pos[id]
        if (!r) continue
        minX = Math.min(minX, r.x)
        minY = Math.min(minY, r.y)
        maxX = Math.max(maxX, r.x + r.w)
        maxY = Math.max(maxY, r.y + r.h)
      }

      const pad = 80
      minX -= pad; minY -= pad; maxX += pad; maxY += pad
      const worldW = maxX - minX
      const worldH = maxY - minY

      const inset = 8
      const availW = MM_W - inset * 2
      const availH = MM_H - inset * 2
      const mScale = Math.min(availW / worldW, availH / worldH)
      const offsetX = inset + (availW - worldW * mScale) / 2
      const offsetY = inset + (availH - worldH * mScale) / 2

      // Store transform for click-to-pan
      minimapTransformRef.current = { minX, minY, mScale, offsetX, offsetY }

      // Background
      mctx.clearRect(0, 0, MM_W, MM_H)
      mctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
      mctx.beginPath()
      mctx.roundRect(0, 0, MM_W, MM_H, 6)
      mctx.fill()

      // Border
      mctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
      mctx.lineWidth = 1
      mctx.beginPath()
      mctx.roundRect(0.5, 0.5, MM_W - 1, MM_H - 1, 6)
      mctx.stroke()

      // Draw cards
      const panels = usePanelStore.getState().panels
      for (const id of ids) {
        const r = pos[id]
        if (!r) continue
        const cx = offsetX + (r.x - minX) * mScale
        const cy = offsetY + (r.y - minY) * mScale
        const cw = r.w * mScale
        const ch = r.h * mScale

        const color = panels[id]?.color ?? '#1c1c1c'
        const isDark = color === '#1c1c1c'
        mctx.fillStyle = isDark ? '#2a2a2a' : color
        mctx.globalAlpha = isDark ? 0.9 : 0.7
        mctx.fillRect(cx, cy, cw, ch)

        mctx.globalAlpha = 0.15
        mctx.strokeStyle = '#fff'
        mctx.lineWidth = 0.5
        mctx.strokeRect(cx, cy, cw, ch)
      }

      mctx.globalAlpha = 1

      // Viewport rect
      const vx = offsetX + (vpWX - minX) * mScale
      const vy = offsetY + (vpWY - minY) * mScale
      const vw = vpWW * mScale
      const vh = vpWH * mScale

      mctx.fillStyle = 'rgba(255, 255, 255, 0.04)'
      mctx.fillRect(vx, vy, vw, vh)
      mctx.strokeStyle = 'rgba(255, 255, 255, 0.45)'
      mctx.lineWidth = 1
      mctx.strokeRect(vx, vy, vw, vh)
    }

    // --- Minimap click-to-pan ---
    function handleMinimapMouseDown(e: MouseEvent): void {
      if (!minimapCanvas) return
      e.stopPropagation()
      e.preventDefault()
      const rect = minimapCanvas.getBoundingClientRect()
      const t = minimapTransformRef.current
      if (!t) return

      function panToMinimap(clientX: number, clientY: number): void {
        const mx = clientX - rect.left
        const my = clientY - rect.top
        const worldX = (mx - t!.offsetX) / t!.mScale + t!.minX
        const worldY = (my - t!.offsetY) / t!.mScale + t!.minY
        const vpW = viewport.clientWidth
        const vpH = viewport.clientHeight
        const scale = scaleRef.current
        canvasXRef.current = vpW / 2 - worldX * scale
        canvasYRef.current = vpH / 2 - worldY * scale
        updateCanvas()
      }

      panToMinimap(e.clientX, e.clientY)

      function onMove(ev: MouseEvent): void {
        panToMinimap(ev.clientX, ev.clientY)
      }
      function onUp(): void {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        scheduleViewportSave()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    if (minimapCanvas) {
      minimapCanvas.addEventListener('mousedown', handleMinimapMouseDown)
    }

    // --- Core update: tile-layer transform + grid + edge indicators + minimap ---
    function updateCanvas(): void {
      tileLayer.style.transform =
        `translate(${canvasXRef.current}px,${canvasYRef.current}px) scale(${scaleRef.current})`
      drawGrid()
      updateEdgeIndicators()
      drawMinimap()
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

    // --- Rubber-band zoom snap-back animation ---
    function animateSnapBack(): void {
      const current = scaleRef.current
      let target: number | null = null
      if (current < MIN_ZOOM) target = MIN_ZOOM
      else if (current > MAX_ZOOM) target = MAX_ZOOM
      if (target === null) return

      const startScale = current
      const startTime = performance.now()
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      const focalX = vw / 2
      const focalY = vh / 2

      function step(now: number): void {
        const t = Math.min((now - startTime) / 200, 1)
        const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
        const prev = scaleRef.current
        const nextScale = startScale + (target! - startScale) * ease
        scaleRef.current = nextScale
        const ratio = nextScale / prev - 1
        canvasXRef.current -= (focalX - canvasXRef.current) * ratio
        canvasYRef.current -= (focalY - canvasYRef.current) * ratio
        updateCanvas()
        showZoomIndicator()
        if (t < 1) {
          snapBackRaf = requestAnimationFrame(step)
        } else {
          snapBackRaf = undefined
          scheduleViewportSave()
        }
      }

      snapBackRaf = requestAnimationFrame(step)
    }

    // --- Focal-point zoom with rubber-band overshoot ---
    function applyZoom(factor: number, focalX: number, focalY: number): void {
      // Cancel any active snap-back
      if (snapBackRaf) {
        cancelAnimationFrame(snapBackRaf)
        snapBackRaf = undefined
      }
      clearTimeout(snapBackTimer)

      const prev = scaleRef.current
      let next = prev * factor

      // Damped overshoot instead of hard clamp
      const K = 400
      if (next < MIN_ZOOM) {
        const overshoot = MIN_ZOOM - next
        next = MIN_ZOOM - overshoot / (1 + overshoot * K)
      } else if (next > MAX_ZOOM) {
        const overshoot = next - MAX_ZOOM
        next = MAX_ZOOM + overshoot / (1 + overshoot * K)
      }

      if (next === prev) return
      scaleRef.current = next
      const ratio = next / prev - 1
      canvasXRef.current -= (focalX - canvasXRef.current) * ratio
      canvasYRef.current -= (focalY - canvasYRef.current) * ratio
      updateCanvas()
      showZoomIndicator()
      scheduleViewportSave()

      // Schedule snap-back after 150ms of no zoom input
      snapBackTimer = setTimeout(() => animateSnapBack(), 150)
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

    // --- Middle-click drag, Space+left-click drag to pan, Left-click drag for marquee ---
    function handleMouseDown(e: MouseEvent): void {
      // Pan: middle-click or space+left-click
      const shouldPan = e.button === 1 || (e.button === 0 && spaceHeld)
      if (shouldPan) {
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
          lastPanEndTime = performance.now()
        }

        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        return
      }

      // Marquee selection: left-click on empty canvas (not card, not edge dot)
      if (e.button === 0 && !(e.target as HTMLElement).closest('.floating-card, .edge-dot')) {
        const startScreenX = e.clientX
        const startScreenY = e.clientY
        const vpRect = viewport.getBoundingClientRect()
        let marqueeEl: HTMLDivElement | null = null

        function onMarqueeMove(ev: MouseEvent): void {
          const dx = ev.clientX - startScreenX
          const dy = ev.clientY - startScreenY
          if (
            !marqueeEl &&
            (Math.abs(dx) > MARQUEE_THRESHOLD || Math.abs(dy) > MARQUEE_THRESHOLD)
          ) {
            marqueeEl = document.createElement('div')
            marqueeEl.className = 'selection-marquee'
            viewport.appendChild(marqueeEl)
            marqueeDidDrag = true
          }
          if (marqueeEl) {
            const left = Math.min(startScreenX, ev.clientX) - vpRect.left
            const top = Math.min(startScreenY, ev.clientY) - vpRect.top
            const width = Math.abs(dx)
            const height = Math.abs(dy)
            marqueeEl.style.left = `${left}px`
            marqueeEl.style.top = `${top}px`
            marqueeEl.style.width = `${width}px`
            marqueeEl.style.height = `${height}px`

            // AABB hit-test all cards (convert marquee rect to canvas-space)
            const scale = scaleRef.current
            const panX = canvasXRef.current
            const panY = canvasYRef.current
            const mL = (left - panX) / scale
            const mT = (top - panY) / scale
            const mR = mL + width / scale
            const mB = mT + height / scale

            selectedIdsRef.current.clear()
            const pos = positionsRef.current
            for (const id of panelIdsRef.current) {
              const r = pos[id]
              if (!r) continue
              if (r.x + r.w > mL && r.x < mR && r.y + r.h > mT && r.y < mB) {
                selectedIdsRef.current.add(id)
              }
            }
            setSelectedIds(new Set(selectedIdsRef.current))
          }
        }

        function onMarqueeUp(): void {
          document.removeEventListener('mousemove', onMarqueeMove)
          document.removeEventListener('mouseup', onMarqueeUp)
          if (marqueeEl) {
            marqueeEl.remove()
            setSelectedIds(new Set(selectedIdsRef.current))
          }
        }

        document.addEventListener('mousemove', onMarqueeMove)
        document.addEventListener('mouseup', onMarqueeUp)
      }
    }

    // --- Click: clear selection on empty canvas (suppressed after marquee) ---
    function handleClick(e: MouseEvent): void {
      if (marqueeDidDrag) {
        marqueeDidDrag = false
        return
      }
      if (!(e.target as HTMLElement).closest('.floating-card, .edge-dot')) {
        selectedIdsRef.current.clear()
        setSelectedIds(new Set())
        setContextMenu(null)
      }
    }

    // --- Double-click: create new terminal at cursor position ---
    function handleDblClick(e: MouseEvent): void {
      if (performance.now() - lastPanEndTime < 500) return
      if ((e.target as HTMLElement).closest('.floating-card')) return

      const vpRect = viewport.getBoundingClientRect()
      const scale = scaleRef.current
      const canvasX = (e.clientX - vpRect.left - canvasXRef.current) / scale
      const canvasY = (e.clientY - vpRect.top - canvasYRef.current) / scale

      handleAddPanelAtRef.current(canvasX, canvasY)
    }

    // --- Right-click context menu ---
    function handleContextMenu(e: MouseEvent): void {
      e.preventDefault()
      const card = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null
      if (card && card.dataset.cardId) {
        const pm = usePanelStore.getState().panels[card.dataset.cardId]
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'card', cardId: card.dataset.cardId, cardType: pm?.type ?? 'terminal' })
      } else {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'canvas' })
      }
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

      // Escape: clear selection and context menu
      if (e.key === 'Escape') {
        selectedIdsRef.current.clear()
        setSelectedIds(new Set())
        setContextMenu(null)
        return
      }

      // Delete/Backspace: remove selected cards
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdsRef.current.size === 0) return
        if (
          selectedIdsRef.current.size > 1 &&
          !window.confirm(`Close ${selectedIdsRef.current.size} terminals?`)
        ) {
          return
        }
        for (const id of selectedIdsRef.current) {
          handleClosePanelRef.current(id)
        }
        selectedIdsRef.current.clear()
        setSelectedIds(new Set())
        return
      }

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
    viewport.addEventListener('click', handleClick)
    viewport.addEventListener('dblclick', handleDblClick)
    viewport.addEventListener('contextmenu', handleContextMenu)
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
      viewport.removeEventListener('click', handleClick)
      viewport.removeEventListener('dblclick', handleDblClick)
      viewport.removeEventListener('contextmenu', handleContextMenu)
      viewport.removeEventListener('auxclick', handleAuxClick)
      edgeContainer.removeEventListener('click', handleEdgeClick)
      if (minimapCanvas) minimapCanvas.removeEventListener('mousedown', handleMinimapMouseDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      ro.disconnect()
      clearTimeout(zoomTimer)
      clearTimeout(viewportSaveTimer)
      clearTimeout(snapBackTimer)
      if (panAnimRaf) cancelAnimationFrame(panAnimRaf)
      if (snapBackRaf) cancelAnimationFrame(snapBackRaf)
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
        addPanel(p.id, p.title, p.color, p.type ?? 'terminal', p.filePath)
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

  // --- Spawn agent terminal (viewer that tails agent transcript) ---
  function handleSpawnAgentTerminal(req: AgentSpawnRequest): void {
    const dedupTag = `#${req.toolUseId}`
    const allPanels = usePanelStore.getState().panels
    for (const id of panelIdsRef.current) {
      if (allPanels[id]?.initialCommand?.includes(dedupTag)) return
    }

    const newId = crypto.randomUUID()
    const title = `@${req.agentName}`
    const viewerCmd = `node -e "` +
      `const fs=require('fs'),path=require('path'),dir='${req.subagentsDir.replace(/'/g, "\\'")}';` +
      `const ex=new Set();try{fs.readdirSync(dir).forEach(f=>{if(f.startsWith('agent-')&&f.endsWith('.jsonl'))ex.add(f)})}catch{}` +
      `process.stdout.write('\\\\x1b[35m\\\\x1b[1m● @${req.agentName.replace(/'/g, "\\'")}\\\\x1b[0m — waiting...\\\\n');` +
      `let claimed=false,pos=0;` +
      `setInterval(()=>{if(claimed)return;try{fs.readdirSync(dir).forEach(f=>{if(!claimed&&f.startsWith('agent-')&&f.endsWith('.jsonl')&&!ex.has(f)){claimed=true;ex.add(f);` +
      `process.stdout.write('\\\\x1b[2K\\\\x1b[1A\\\\x1b[2K\\\\x1b[35m\\\\x1b[1m● @${req.agentName.replace(/'/g, "\\'")}\\\\x1b[0m — running\\\\n\\\\n');` +
      `const fp=path.join(dir,f);setInterval(()=>{try{const s=fs.statSync(fp).size;if(s<=pos)return;const b=Buffer.alloc(s-pos),fd=fs.openSync(fp,'r');fs.readSync(fd,b,0,b.length,pos);fs.closeSync(fd);pos=s;` +
      `b.toString().split('\\\\n').forEach(l=>{if(!l.trim())return;try{const d=JSON.parse(l);` +
      `if(d.type==='assistant'&&d.message&&d.message.content){d.message.content.forEach(c=>{` +
      `if(c.type==='text')process.stdout.write(c.text+'\\\\n');` +
      `if(c.type==='tool_use')process.stdout.write('\\\\x1b[36m  ▸ '+c.name+(c.input&&c.input.file_path?' '+c.input.file_path:c.input&&c.input.command?' $ '+c.input.command.split('\\\\n')[0]:'')+'\\\\x1b[0m\\\\n')})}` +
      `if(d.type==='result'){process.stdout.write('\\\\n\\\\x1b[32m✓ Done\\\\x1b[0m\\\\n')}}catch{}})}catch{}},200)}})` +
      `}catch{}},200)` +
      `" ${dedupTag}`
    addPanel(newId, title, colors.purple, 'terminal', undefined, viewerCmd)

    // Position to the right of rightmost panel
    let x = 40, y = 40
    for (const id of panelIdsRef.current) {
      const pos = positionsRef.current[id]
      if (pos) { const r = pos.x + pos.w + 40; if (r > x) { x = r; y = pos.y } }
    }
    x = snapToGrid(x); y = snapToGrid(y)
    const newZ = ++topZRef.current
    const newRect: CardRect = { x, y, w: DEFAULT_W, h: DEFAULT_H, z: newZ }

    setPanelIds(prev => { const next = [...prev, newId]; panelIdsRef.current = next; return next })
    setPositions(prev => {
      const next = { ...prev, [newId]: newRect }
      positionsRef.current = next
      triggerSave([...panelIdsRef.current], next)
      return next
    })
  }

  // --- Open file in editor tile ---
  function handleOpenFile(filePath: string): void {
    // Check if file is already open -> bring to front
    const allPanels = usePanelStore.getState().panels
    for (const id of panelIdsRef.current) {
      const pm = allPanels[id]
      if (pm && pm.type === 'editor' && pm.filePath === filePath) {
        handleBringToFront(id)
        return
      }
    }

    // Create new editor panel
    const newId = crypto.randomUUID()
    const fileName = filePath.split('/').pop() ?? 'Untitled'
    addPanel(newId, fileName, undefined, 'editor', filePath)

    // Position at viewport center
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

  // Subscribe to pendingFileOpen from projectStore
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.pendingFileOpen && state.pendingFileOpen !== prev.pendingFileOpen) {
        handleOpenFile(state.pendingFileOpen)
        useProjectStore.getState().clearPendingFileOpen()
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to pendingAgentSpawn from projectStore
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.pendingAgentSpawn && state.pendingAgentSpawn !== prev.pendingAgentSpawn) {
        handleSpawnAgentTerminal(state.pendingAgentSpawn)
        useProjectStore.getState().clearPendingAgentSpawn()
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

  // --- Selection helpers ---
  function commitSelection(): void {
    setSelectedIds(new Set(selectedIdsRef.current))
  }

  function clearSelection(): void {
    selectedIdsRef.current.clear()
    setSelectedIds(new Set())
  }

  function handleCardSelect(id: string, shiftKey: boolean): void {
    if (shiftKey) {
      if (selectedIdsRef.current.has(id)) {
        selectedIdsRef.current.delete(id)
      } else {
        selectedIdsRef.current.add(id)
      }
    } else {
      selectedIdsRef.current.clear()
      selectedIdsRef.current.add(id)
    }
    commitSelection()
  }

  // --- Group drag helpers ---
  function getGroupDragContext(
    draggedId: string
  ): Array<{ id: string; x: number; y: number }> | null {
    if (selectedIdsRef.current.size <= 1 || !selectedIdsRef.current.has(draggedId)) return null
    const peers: Array<{ id: string; x: number; y: number }> = []
    for (const id of selectedIdsRef.current) {
      if (id === draggedId) continue
      const pos = positionsRef.current[id]
      if (pos) peers.push({ id, x: pos.x, y: pos.y })
    }
    return peers.length > 0 ? peers : null
  }

  function handleGroupMove(moves: Array<{ id: string; x: number; y: number }>): void {
    setPositions((prev) => {
      const next = { ...prev }
      for (const m of moves) {
        if (next[m.id]) next[m.id] = { ...next[m.id], x: m.x, y: m.y }
      }
      positionsRef.current = next
      triggerSave(panelIdsRef.current, next)
      return next
    })
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

  function handleAddPanelAt(x: number, y: number): void {
    const newId = crypto.randomUUID()
    addPanel(newId)

    const newZ = ++topZRef.current
    const newRect: CardRect = {
      x: snapToGrid(x - DEFAULT_W / 2),
      y: snapToGrid(y - DEFAULT_H / 2),
      w: DEFAULT_W,
      h: DEFAULT_H,
      z: newZ
    }

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
    const panelMeta = usePanelStore.getState().panels[id]
    if (!panelMeta || panelMeta.type !== 'editor') {
      window.electronAPI.ptyKill(id)
    }
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

  // Keep refs updated for access from the main effect
  handleAddPanelAtRef.current = handleAddPanelAt
  handleClosePanelRef.current = handleClosePanel

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

  function handleResizeWithMove(
    id: string,
    x: number,
    y: number,
    w: number,
    h: number
  ): void {
    setPositions((prev) => {
      const next = { ...prev, [id]: { ...prev[id], x, y, w, h } }
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
            const pm = panels[id]
            return (
              <FloatingCard
                key={id}
                sessionId={id}
                cwd={folderPath ?? '.'}
                rect={rect}
                zoomRef={scaleRef}
                selected={selectedIds.has(id)}
                type={pm?.type ?? 'terminal'}
                filePath={pm?.filePath}
                onSelect={handleCardSelect}
                onMove={handleMove}
                onResize={handleResize}
                onResizeWithMove={handleResizeWithMove}
                onBringToFront={handleBringToFront}
                onClose={handleClosePanel}
                onGroupDragContext={getGroupDragContext}
                onGroupMove={handleGroupMove}
              />
            )
          })}
        </div>
        <div ref={edgeIndicatorsRef} className="terminal-canvas-edge-indicators" />
        <div ref={zoomIndicatorRef} className="terminal-canvas-zoom-indicator" />
        <canvas ref={minimapCanvasRef} className="terminal-canvas-minimap" />
        {panelIds.length === 0 && (
          <div className="terminal-canvas-empty-overlay">
            <div className="terminal-canvas-empty">
              <div className="terminal-canvas-empty-ghost">
                <div className="terminal-canvas-empty-ghost-header" />
                <div className="terminal-canvas-empty-ghost-body" />
              </div>
              <p className="terminal-canvas-empty-text">
                Double-click the canvas or right-click for <strong>New terminal</strong>
              </p>
            </div>
          </div>
        )}
      </div>
      {modal && (
        <PanelModal
          type={modal.type}
          cardId={modal.cardId}
          onDismiss={() => setModal(null)}
        />
      )}
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          type={contextMenu.type}
          cardId={contextMenu.cardId}
          cardType={contextMenu.cardType}
          onNewTerminal={() => {
            clearSelection()
            handleAddPanel()
          }}
          onRenameTerminal={(id) => setModal({ type: 'rename', cardId: id })}
          onChangeColor={(id) => setModal({ type: 'color', cardId: id })}
          onCloseTerminal={handleClosePanel}
          onDismiss={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
