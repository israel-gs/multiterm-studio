import { useState, useRef, useEffect } from 'react'
import { FloatingCard } from './FloatingCard'
import type { CardRect } from './FloatingCard'
import { PanelModal } from './PanelModal'
import { CanvasToolbar } from './CanvasToolbar'
import { NewTerminalModal } from './NewTerminalModal'
import { usePanelStore } from '../store/panelStore'
import { useProjectStore } from '../store/projectStore'
import type { AgentSpawnRequest, PaneCreateRequest } from '../store/projectStore'
import { scheduleSave } from '../utils/layoutPersistence'
import { colors } from '../tokens'

export interface SavedLayoutShape {
  version: number
  panelIds?: string[]
  tree?: unknown
  panels: Array<{
    id: string
    title: string
    color: string
    type?: 'terminal' | 'editor' | 'note' | 'image'
    filePath?: string
    noteContent?: string
  }>
  positions?: Record<string, CardRect>
  viewport?: { panX: number; panY: number; zoom: number; centerX?: number; centerY?: number }
}

interface TerminalCanvasProps {
  savedLayout?: SavedLayoutShape | null
}

const DEFAULT_W = 620
const DEFAULT_H = 420
const NOTE_W = 280
const NOTE_H = 220
const IMAGE_W = 280
const IMAGE_H = 280
const CASCADE_OFFSET = 30
const MIN_ZOOM = 0.15
const MAX_ZOOM = 3.0
const GRID_CELL = 24
const GRID_MAJOR = 5
const EDGE_INSET = 12
const MARQUEE_THRESHOLD = 3
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'])

function inferTileType(filePath: string): 'editor' | 'image' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTS.has(ext) ? 'image' : 'editor'
}

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

/**
 * Find a position for a new tile that doesn't overlap existing ones.
 * Starts at (idealX, idealY) and spirals outward in grid steps until a
 * non-overlapping spot is found (up to maxAttempts).
 */
function findNonOverlappingPosition(
  idealX: number,
  idealY: number,
  w: number,
  h: number,
  positions: Record<string, CardRect>
): { x: number; y: number } {
  const GAP = GRID_CELL // minimum gap between tiles
  const rects = Object.values(positions)

  function overlaps(x: number, y: number): boolean {
    for (const r of rects) {
      if (x < r.x + r.w + GAP && x + w + GAP > r.x && y < r.y + r.h + GAP && y + h + GAP > r.y)
        return true
    }
    return false
  }

  // Try ideal position first
  let x = snapToGrid(idealX)
  let y = snapToGrid(idealY)
  if (!overlaps(x, y)) return { x, y }

  // Spiral outward: try right, then below, expanding radius
  const step = GRID_CELL * 2
  for (let radius = 1; radius <= 20; radius++) {
    const offset = radius * step
    // Right of ideal
    x = snapToGrid(idealX + offset)
    y = snapToGrid(idealY)
    if (!overlaps(x, y)) return { x, y }
    // Below ideal
    x = snapToGrid(idealX)
    y = snapToGrid(idealY + offset)
    if (!overlaps(x, y)) return { x, y }
    // Right-below diagonal
    x = snapToGrid(idealX + offset)
    y = snapToGrid(idealY + offset)
    if (!overlaps(x, y)) return { x, y }
    // Left of ideal
    x = snapToGrid(idealX - offset)
    y = snapToGrid(idealY)
    if (!overlaps(x, y)) return { x, y }
    // Above ideal
    x = snapToGrid(idealX)
    y = snapToGrid(idealY - offset)
    if (!overlaps(x, y)) return { x, y }
    // Left-below
    x = snapToGrid(idealX - offset)
    y = snapToGrid(idealY + offset)
    if (!overlaps(x, y)) return { x, y }
    // Right-above
    x = snapToGrid(idealX + offset)
    y = snapToGrid(idealY - offset)
    if (!overlaps(x, y)) return { x, y }
    // Left-above
    x = snapToGrid(idealX - offset)
    y = snapToGrid(idealY - offset)
    if (!overlaps(x, y)) return { x, y }
  }

  // Fallback: place with offset to avoid exact overlap
  return { x: snapToGrid(idealX + GRID_CELL * 2), y: snapToGrid(idealY + GRID_CELL * 2) }
}

function buildLayoutSnapshot(
  panelIds: string[],
  positions: Record<string, CardRect>,
  viewport: { panX: number; panY: number; zoom: number; centerX?: number; centerY?: number }
): SavedLayoutShape {
  const allPanels = usePanelStore.getState().panels
  const panels = panelIds
    .filter((id) => allPanels[id])
    .map((id) => ({
      id,
      title: allPanels[id].title,
      color: allPanels[id].color,
      type: allPanels[id].type,
      filePath: allPanels[id].filePath,
      noteContent: allPanels[id].noteContent
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
  const topZRef = useRef(Math.max(...Object.values(initRef.current.positions).map((r) => r.z), 0))

  // Viewport state (refs for perf during continuous pan/zoom)
  // Prefer centerpoint-based restore to avoid drift on window resize
  const savedVp = savedLayout?.viewport
  const initZoom = savedVp?.zoom ?? 1
  const canvasXRef = useRef(savedVp?.panX ?? 0)
  const canvasYRef = useRef(savedVp?.panY ?? 0)
  const scaleRef = useRef(initZoom)
  const viewportCenterRestored = useRef(false)
  const savedCenterX = useRef(savedVp?.centerX)
  const savedCenterY = useRef(savedVp?.centerY)

  // DOM refs
  const viewportRef = useRef<HTMLDivElement>(null)
  const gridCanvasRef = useRef<HTMLCanvasElement>(null)
  const tileLayerRef = useRef<HTMLDivElement>(null)
  const edgeIndicatorsRef = useRef<HTMLDivElement>(null)
  const zoomIndicatorRef = useRef<HTMLDivElement>(null)
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null)
  const minimapTransformRef = useRef<{
    minX: number
    minY: number
    mScale: number
    offsetX: number
    offsetY: number
  } | null>(null)

  // Edge dot tracking (component-level so handleClosePanel can clean up)
  const edgeDotMapRef = useRef(new Map<string, HTMLDivElement>())
  const edgeDotFadeOutsRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  // Expose updateCanvas to call from outside the main effect
  const updateCanvasRef = useRef<() => void>(() => {})

  // Selection state
  const selectedIdsRef = useRef<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Focused card state (content overlay / drag-by-default)
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null)
  const focusedCardIdRef = useRef<string | null>(null)

  // Context menu state
  const [modal, setModal] = useState<{ type: 'rename' | 'color'; cardId: string } | null>(null)
  const [showNewTerminal, setShowNewTerminal] = useState(false)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)
  const maximizedIdRef = useRef<string | null>(null)

  // Refs for accessing component-level functions from the main effect
  const handleAddPanelRef = useRef<() => void>(() => {})
  const handleAddPanelAtRef = useRef<(x: number, y: number) => void>(() => {})
  const handleAddNoteRef = useRef<() => void>(() => {})
  const handleClosePanelRef = useRef<(id: string) => void>(() => {})
  const zoomToFitAllRef = useRef<() => void>(() => {})
  const handleSpatialNavRef = useRef<(dir: 'left' | 'right' | 'up' | 'down') => void>(() => {})
  const panToTileRef = useRef<(id: string) => void>(() => {})
  const handleTidyRef = useRef<() => void>(() => {})
  const handleDuplicateRef = useRef<(id: string) => void>(() => {})
  const handleToggleMaximizeRef = useRef<(id: string) => void>(() => {})

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
  useEffect(() => {
    focusedCardIdRef.current = focusedCardId
  }, [focusedCardId])
  useEffect(() => {
    maximizedIdRef.current = maximizedId
  }, [maximizedId])

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

      // Detect light theme for grid dot colors
      const isLight =
        document.documentElement.dataset.theme === 'light' ||
        (document.documentElement.dataset.theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: light)').matches)

      // Minor dots
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)'
      const ds = Math.max(1, 1.5 * scale)
      for (let x = offX; x < w; x += step) {
        for (let y = offY; y < h; y += step) {
          ctx.fillRect(x - ds / 2, y - ds / 2, ds, ds)
        }
      }

      // Major dots
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)'
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
      let minX = vpWX,
        minY = vpWY,
        maxX = vpWX + vpWW,
        maxY = vpWY + vpWH
      for (const id of ids) {
        const r = pos[id]
        if (!r) continue
        minX = Math.min(minX, r.x)
        minY = Math.min(minY, r.y)
        maxX = Math.max(maxX, r.x + r.w)
        maxY = Math.max(maxY, r.y + r.h)
      }

      const pad = 80
      minX -= pad
      minY -= pad
      maxX += pad
      maxY += pad
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
      const mmIsLight =
        document.documentElement.dataset.theme === 'light' ||
        (document.documentElement.dataset.theme === 'system' &&
          window.matchMedia('(prefers-color-scheme: light)').matches)
      mctx.clearRect(0, 0, MM_W, MM_H)
      mctx.fillStyle = mmIsLight ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.55)'
      mctx.beginPath()
      mctx.roundRect(0, 0, MM_W, MM_H, 6)
      mctx.fill()

      // Border
      mctx.strokeStyle = mmIsLight ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.06)'
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

      mctx.fillStyle = mmIsLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.04)'
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
      tileLayer.style.transform = `translate(${canvasXRef.current}px,${canvasYRef.current}px) scale(${scaleRef.current})`
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
        const vw = viewport.clientWidth
        const vh = viewport.clientHeight
        const zoom = scaleRef.current
        scheduleSave(
          fp,
          buildLayoutSnapshot(panelIdsRef.current, positionsRef.current, {
            panX: canvasXRef.current,
            panY: canvasYRef.current,
            zoom,
            centerX: (vw / 2 - canvasXRef.current) / zoom,
            centerY: (vh / 2 - canvasYRef.current) / zoom
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
    panToTileRef.current = panToTile

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
        setFocusedCardId(null)
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

    // --- Right-click context menu (native) ---
    // Uses capture phase (registered with `true`) so it fires before xterm.js
    // mouse handlers which would otherwise swallow the event in mouse mode.
    function handleContextMenu(e: MouseEvent): void {
      e.preventDefault()
      e.stopPropagation()
      const card = (e.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null

      if (card && card.dataset.cardId) {
        const cardId = card.dataset.cardId
        const pm = usePanelStore.getState().panels[cardId]
        const closeLabel =
          pm?.type === 'editor'
            ? 'Close editor'
            : pm?.type === 'note'
              ? 'Close note'
              : 'Close terminal'
        const isMaximized = maximizedId === cardId
        window.electronAPI
          .contextMenuShow([
            { id: 'rename', label: 'Rename' },
            { id: 'color', label: 'Change color' },
            { id: 'maximize', label: isMaximized ? 'Restore' : 'Maximize' },
            { id: 'duplicate', label: 'Duplicate' },
            { id: 'separator' },
            { id: 'close', label: closeLabel }
          ])
          .then((selected) => {
            if (selected === 'rename') setModal({ type: 'rename', cardId })
            else if (selected === 'color') setModal({ type: 'color', cardId })
            else if (selected === 'maximize') handleToggleMaximizeRef.current(cardId)
            else if (selected === 'duplicate') handleDuplicateRef.current(cardId)
            else if (selected === 'close') handleClosePanelRef.current(cardId)
          })
      } else {
        window.electronAPI
          .contextMenuShow([
            { id: 'new-terminal', label: 'New terminal' },
            { id: 'new-note', label: 'New note' },
            { id: 'separator' },
            { id: 'tidy', label: 'Tidy selection' },
            { id: 'zoom-fit', label: 'Zoom to fit all' }
          ])
          .then((selected) => {
            if (selected === 'new-terminal') {
              clearSelection()
              handleAddPanelRef.current()
            } else if (selected === 'new-note') {
              clearSelection()
              handleAddNoteRef.current()
            } else if (selected === 'tidy') {
              handleTidyRef.current()
            } else if (selected === 'zoom-fit') {
              zoomToFitAllRef.current()
            }
          })
      }
    }

    // --- Edge indicator click (event delegation) → pan + highlight ---
    function handleEdgeClick(e: MouseEvent): void {
      const dot = (e.target as HTMLElement).closest('.edge-dot') as HTMLElement | null
      if (dot?.dataset.tileId) {
        const tileId = dot.dataset.tileId
        panToTile(tileId)
        // Highlight the tile after pan animation completes
        setTimeout(() => {
          const el = document.querySelector(`[data-card-id="${tileId}"]`) as HTMLElement | null
          if (el) {
            el.classList.add('floating-card--highlight')
            setTimeout(() => el.classList.remove('floating-card--highlight'), 1200)
          }
        }, 360) // slightly after 350ms pan animation
      }
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
          setFocusedCardId(null)
          // Blur focused terminal so space doesn't type into it
          const active = document.activeElement as HTMLElement | null
          if (active?.closest?.('.floating-card')) active.blur()
        }
        return
      }

      // Allow Cmd+Opt and Cmd+Shift combos through even when inside a card
      const insideCard = !!(e.target as HTMLElement).closest('.floating-card')
      if (insideCard && !(e.metaKey && (e.altKey || e.shiftKey))) return

      // Escape: restore maximized → unfocus card → clear selection
      if (e.key === 'Escape') {
        if (maximizedId) {
          setMaximizedId(null)
          return
        }
        if (focusedCardIdRef.current) {
          setFocusedCardId(null)
          ;(document.activeElement as HTMLElement)?.blur()
          return
        }
        selectedIdsRef.current.clear()
        setSelectedIds(new Set())
        return
      }

      // Delete/Backspace: remove selected cards (with confirmation)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIdsRef.current.size === 0) return
        const count = selectedIdsRef.current.size
        const label = count === 1 ? 'Close this tile?' : `Close ${count} tiles?`
        if (!window.confirm(label)) return
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

      // Cmd+Opt+0: Zoom to fit all tiles
      if (e.key === '0' && e.metaKey && e.altKey) {
        e.preventDefault()
        zoomToFitAllRef.current()
        return
      }

      // Cmd+Opt+F: Zoom to fit focused tile
      if (e.key === 'f' && e.metaKey && e.altKey) {
        e.preventDefault()
        if (focusedCardIdRef.current) zoomToFitAllRef.current()
        return
      }

      // Cmd+Opt+T: Tidy/arrange selected tiles
      if (e.key === 't' && e.metaKey && e.altKey) {
        e.preventDefault()
        handleTidyRef.current()
        return
      }

      // Cmd+Shift+D: Duplicate focused terminal
      if ((e.key === 'd' || e.key === 'D') && e.metaKey && e.shiftKey) {
        e.preventDefault()
        if (focusedCardIdRef.current) handleDuplicateRef.current(focusedCardIdRef.current)
        return
      }

      // Cmd+Opt+Arrows: Spatial navigation between tiles
      if (
        e.metaKey &&
        e.altKey &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        e.preventDefault()
        const dir = e.key.replace('Arrow', '').toLowerCase() as 'left' | 'right' | 'up' | 'down'
        handleSpatialNavRef.current(dir)
        return
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
    viewport.addEventListener('contextmenu', handleContextMenu, true)
    viewport.addEventListener('auxclick', handleAuxClick)
    edgeContainer.addEventListener('click', handleEdgeClick)
    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp)

    const ro = new ResizeObserver(() => {
      // On first resize, restore viewport from saved centerpoint to avoid drift
      if (
        !viewportCenterRestored.current &&
        savedCenterX.current != null &&
        savedCenterY.current != null
      ) {
        viewportCenterRestored.current = true
        const vw = viewport.clientWidth
        const vh = viewport.clientHeight
        if (vw > 0 && vh > 0) {
          canvasXRef.current = vw / 2 - savedCenterX.current * scaleRef.current
          canvasYRef.current = vh / 2 - savedCenterY.current * scaleRef.current
        }
      }
      updateCanvas()
    })
    ro.observe(viewport)

    // Initial draw
    updateCanvas()

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('mousedown', handleMouseDown)
      viewport.removeEventListener('click', handleClick)
      viewport.removeEventListener('dblclick', handleDblClick)
      viewport.removeEventListener('contextmenu', handleContextMenu, true)
      viewport.removeEventListener('auxclick', handleAuxClick)
      edgeContainer.removeEventListener('click', handleEdgeClick)
      if (minimapCanvas) minimapCanvas.removeEventListener('mousedown', handleMinimapMouseDown)
      window.removeEventListener('keydown', handleKeyDown, true)
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
        if (p.type === 'note' && p.noteContent) {
          usePanelStore.getState().setNoteContent(p.id, p.noteContent)
        }
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
        if (
          prevPanel &&
          (cur.title !== prevPanel.title ||
            cur.color !== prevPanel.color ||
            cur.noteContent !== prevPanel.noteContent)
        ) {
          // Redraw minimap when color changes
          if (cur.color !== prevPanel.color) updateCanvasRef.current()
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
    const viewerCmd =
      `node -e "` +
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
    let x = 40,
      y = 40
    for (const id of panelIdsRef.current) {
      const pos = positionsRef.current[id]
      if (pos) {
        const r = pos.x + pos.w + 40
        if (r > x) {
          x = r
          y = pos.y
        }
      }
    }
    x = snapToGrid(x)
    y = snapToGrid(y)
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

  // --- Spawn interactive pane (RPC pane.split → new FloatingCard with full PTY) ---
  function handleSpawnInteractivePane(req: PaneCreateRequest): void {
    // Dedup: check if this sessionId already exists
    if (panelIdsRef.current.includes(req.sessionId)) {
      window.electronAPI.paneCreated(req.sessionId)
      return
    }

    addPanel(
      req.sessionId,
      req.title ?? 'Terminal',
      colors.cyan,
      'terminal',
      undefined,
      undefined,
      req.cwd
    )

    // Position to the right of parent card if provided, else rightmost panel
    let x = 40,
      y = 40
    if (req.parentSessionId) {
      const parentPos = positionsRef.current[req.parentSessionId]
      if (parentPos) {
        x = snapToGrid(parentPos.x + parentPos.w + 40)
        y = snapToGrid(parentPos.y)
      }
    }
    if (x === 40 && y === 40) {
      for (const id of panelIdsRef.current) {
        const pos = positionsRef.current[id]
        if (pos) {
          const r = pos.x + pos.w + 40
          if (r > x) {
            x = r
            y = pos.y
          }
        }
      }
      x = snapToGrid(x)
      y = snapToGrid(y)
    }

    const newZ = ++topZRef.current
    const newRect: CardRect = { x, y, w: DEFAULT_W, h: DEFAULT_H, z: newZ }

    setPanelIds((prev) => {
      const next = [...prev, req.sessionId]
      panelIdsRef.current = next
      return next
    })
    setPositions((prev) => {
      const next = { ...prev, [req.sessionId]: newRect }
      positionsRef.current = next
      triggerSave([...panelIdsRef.current], next)
      return next
    })

    // Acknowledge creation back to main process (unblocks RPC response)
    window.electronAPI.paneCreated(req.sessionId)
  }

  // Subscribe to pendingPaneCreate from projectStore
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.pendingPaneCreate && state.pendingPaneCreate !== prev.pendingPaneCreate) {
        handleSpawnInteractivePane(state.pendingPaneCreate)
        useProjectStore.getState().clearPendingPaneCreate()
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Subscribe to pendingFocus from panelStore (agent focus, RPC pane.focus)
  useEffect(() => {
    const unsubscribe = usePanelStore.subscribe((state, prev) => {
      if (state.pendingFocus && state.pendingFocus !== prev.pendingFocus) {
        handleBringToFront(state.pendingFocus)
        usePanelStore.getState().clearPendingFocus()
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Open file in editor or image tile ---
  function handleOpenFile(filePath: string): void {
    const wasMaximized = !!maximizedIdRef.current

    // Route images to handleAddImage
    if (inferTileType(filePath) === 'image') {
      if (wasMaximized) setMaximizedId(null)
      handleAddImage(filePath)
      return
    }

    // Check if file is already open -> maximize it (or bring to front)
    const allPanels = usePanelStore.getState().panels
    for (const id of panelIdsRef.current) {
      const pm = allPanels[id]
      if (pm && pm.type === 'editor' && pm.filePath === filePath) {
        if (wasMaximized) {
          setMaximizedId(id)
        } else {
          handleBringToFront(id)
        }
        return
      }
    }

    // Create new editor panel
    const newId = crypto.randomUUID()
    const fileName = filePath.split('/').pop() ?? 'Untitled'
    addPanel(newId, fileName, undefined, 'editor', filePath)

    // Position at viewport center, avoiding overlap
    const viewport = viewportRef.current
    const scale = scaleRef.current
    let idealX = 40
    let idealY = 40
    if (viewport) {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      idealX = (vw / 2 - canvasXRef.current) / scale - DEFAULT_W / 2
      idealY = (vh / 2 - canvasYRef.current) / scale - DEFAULT_H / 2
    }

    const { x, y } = findNonOverlappingPosition(
      idealX,
      idealY,
      DEFAULT_W,
      DEFAULT_H,
      positionsRef.current
    )
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

    // If a tile was maximized, maximize the new file instead
    // Use requestAnimationFrame so the new panel renders first
    if (wasMaximized) {
      requestAnimationFrame(() => {
        setMaximizedId(newId)
        setFocusedCardId(newId)
      })
    } else {
      setFocusedCardId(newId)
      requestAnimationFrame(() => panToTileRef.current(newId))
    }
  }

  // Listen for menu bar actions
  useEffect(() => {
    const unsub = window.electronAPI.onMenuAction((action) => {
      switch (action) {
        case 'new-terminal':
          setShowNewTerminal(true)
          break
        case 'new-note':
          handleAddNoteRef.current()
          break
        case 'duplicate':
          if (focusedCardIdRef.current) handleDuplicateRef.current(focusedCardIdRef.current)
          break
        case 'close-tile':
          if (focusedCardIdRef.current) handleClosePanelRef.current(focusedCardIdRef.current)
          break
        case 'zoom-fit-all':
          zoomToFitAllRef.current()
          break
        case 'zoom-fit-focused':
          if (focusedCardIdRef.current) zoomToFitAllRef.current()
          break
        case 'tidy':
          handleTidyRef.current()
          break
        case 'nav-left':
          handleSpatialNavRef.current('left')
          break
        case 'nav-right':
          handleSpatialNavRef.current('right')
          break
        case 'nav-up':
          handleSpatialNavRef.current('up')
          break
        case 'nav-down':
          handleSpatialNavRef.current('down')
          break
      }
    })
    return unsub
  }, [])

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

  // Subscribe to pendingTerminalCwd from projectStore (open terminal at specific path)
  useEffect(() => {
    const unsubscribe = useProjectStore.subscribe((state, prev) => {
      if (state.pendingTerminalCwd && state.pendingTerminalCwd !== prev.pendingTerminalCwd) {
        const cwd = state.pendingTerminalCwd
        useProjectStore.getState().clearPendingTerminalCwd()
        const dirName = cwd.split('/').pop() || 'Terminal'
        handleCreateTerminal(dirName, '', cwd)
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
  function getViewport(): {
    panX: number
    panY: number
    zoom: number
    centerX?: number
    centerY?: number
  } {
    const vp = viewportRef.current
    const zoom = scaleRef.current
    const result: { panX: number; panY: number; zoom: number; centerX?: number; centerY?: number } =
      {
        panX: canvasXRef.current,
        panY: canvasYRef.current,
        zoom
      }
    if (vp) {
      result.centerX = (vp.clientWidth / 2 - canvasXRef.current) / zoom
      result.centerY = (vp.clientHeight / 2 - canvasYRef.current) / zoom
    }
    return result
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

    // Place new card at the center of the current viewport, avoiding overlap
    const viewport = viewportRef.current
    const scale = scaleRef.current
    let idealX = 40
    let idealY = 40

    if (viewport) {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      idealX = (vw / 2 - canvasXRef.current) / scale - DEFAULT_W / 2
      idealY = (vh / 2 - canvasYRef.current) / scale - DEFAULT_H / 2
    }

    const { x, y } = findNonOverlappingPosition(
      idealX,
      idealY,
      DEFAULT_W,
      DEFAULT_H,
      positionsRef.current
    )
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

  function handleAddPanelAt(cx: number, cy: number): void {
    const newId = crypto.randomUUID()
    addPanel(newId)

    const { x, y } = findNonOverlappingPosition(
      cx - DEFAULT_W / 2,
      cy - DEFAULT_H / 2,
      DEFAULT_W,
      DEFAULT_H,
      positionsRef.current
    )
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

  function handleAddNote(): void {
    const newId = crypto.randomUUID()
    addPanel(newId, 'Note', colors.yellow, 'note')

    const viewport = viewportRef.current
    const scale = scaleRef.current
    let idealX = 40
    let idealY = 40

    if (viewport) {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      idealX = (vw / 2 - canvasXRef.current) / scale - NOTE_W / 2
      idealY = (vh / 2 - canvasYRef.current) / scale - NOTE_H / 2
    }

    const { x, y } = findNonOverlappingPosition(
      idealX,
      idealY,
      NOTE_W,
      NOTE_H,
      positionsRef.current
    )
    const newZ = ++topZRef.current
    const newRect: CardRect = { x, y, w: NOTE_W, h: NOTE_H, z: newZ }

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

  function handleAddImage(filePath: string, cx?: number, cy?: number): void {
    // Check if image is already open -> bring to front
    const allPanels = usePanelStore.getState().panels
    for (const id of panelIdsRef.current) {
      const pm = allPanels[id]
      if (pm && pm.type === 'image' && pm.filePath === filePath) {
        const newZ = ++topZRef.current
        setPositions((prev) => {
          const next = { ...prev, [id]: { ...prev[id], z: newZ } }
          positionsRef.current = next
          return next
        })
        return
      }
    }

    const newId = crypto.randomUUID()
    const fileName = filePath.split('/').pop() ?? 'Image'
    addPanel(newId, fileName, colors.bgCard, 'image', filePath)

    const viewport = viewportRef.current
    const scale = scaleRef.current
    let idealX = cx ?? 40
    let idealY = cy ?? 40

    if (cx == null && viewport) {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      idealX = (vw / 2 - canvasXRef.current) / scale - IMAGE_W / 2
      idealY = (vh / 2 - canvasYRef.current) / scale - IMAGE_H / 2
    }

    const { x, y } = findNonOverlappingPosition(
      idealX,
      idealY,
      IMAGE_W,
      IMAGE_H,
      positionsRef.current
    )
    const newZ = ++topZRef.current
    const newRect: CardRect = { x, y, w: IMAGE_W, h: IMAGE_H, z: newZ }

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

  function handleOpenFileAt(filePath: string, cx: number, cy: number): void {
    // Check if file is already open
    const allPanels = usePanelStore.getState().panels
    for (const id of panelIdsRef.current) {
      const pm = allPanels[id]
      if (pm && pm.type === 'editor' && pm.filePath === filePath) {
        const newZ = ++topZRef.current
        setPositions((prev) => {
          const next = { ...prev, [id]: { ...prev[id], z: newZ } }
          positionsRef.current = next
          return next
        })
        return
      }
    }

    const newId = crypto.randomUUID()
    const fileName = filePath.split('/').pop() ?? 'File'
    addPanel(newId, fileName, colors.bgCard, 'editor', filePath)

    const { x, y } = findNonOverlappingPosition(cx, cy, DEFAULT_W, DEFAULT_H, positionsRef.current)
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
    // Check for running process before closing
    const panelMeta = usePanelStore.getState().panels[id]
    if (panelMeta?.type === 'terminal' && panelMeta.hasProcess) {
      if (!window.confirm('This terminal has a running process. Close anyway?')) {
        return
      }
    }

    if (focusedCardIdRef.current === id) setFocusedCardId(null)
    if (maximizedId === id) setMaximizedId(null)

    if (
      !panelMeta ||
      (panelMeta.type !== 'editor' && panelMeta.type !== 'note' && panelMeta.type !== 'image')
    ) {
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
  handleAddPanelRef.current = handleAddPanel
  handleAddPanelAtRef.current = handleAddPanelAt
  handleAddNoteRef.current = handleAddNote
  handleClosePanelRef.current = handleClosePanel
  zoomToFitAllRef.current = zoomToFitAll
  handleSpatialNavRef.current = handleSpatialNavigation
  handleTidyRef.current = handleTidySelection
  handleDuplicateRef.current = handleDuplicateTile

  // --- Zoom to fit tiles in viewport ---
  function zoomToFitIds(ids: string[]): void {
    if (ids.length === 0) return
    const vp = viewportRef.current
    if (!vp) return

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const id of ids) {
      const r = positionsRef.current[id]
      if (!r) continue
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.w)
      maxY = Math.max(maxY, r.y + r.h)
    }
    if (!isFinite(minX)) return

    const padding = 60
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    const vpW = vp.clientWidth
    const vpH = vp.clientHeight
    const scale = Math.min(
      Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (vpW - padding * 2) / bboxW)),
      Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, (vpH - padding * 2) / bboxH))
    )
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    scaleRef.current = scale
    canvasXRef.current = vpW / 2 - cx * scale
    canvasYRef.current = vpH / 2 - cy * scale
    updateCanvasRef.current()
    triggerSave(panelIdsRef.current, positionsRef.current)
  }

  function zoomToFitAll(): void {
    zoomToFitIds(panelIdsRef.current)
  }

  // --- Spatial navigation ---
  function handleSpatialNavigation(dir: 'left' | 'right' | 'up' | 'down'): void {
    const focusedId = focusedCardIdRef.current
    if (!focusedId) {
      // No focused tile — focus first one
      if (panelIdsRef.current.length > 0) {
        const id = panelIdsRef.current[0]
        setFocusedCardId(id)
        handleBringToFront(id)
      }
      return
    }

    const from = positionsRef.current[focusedId]
    if (!from) return
    const fromCx = from.x + from.w / 2
    const fromCy = from.y + from.h / 2

    let bestId: string | null = null
    let bestDist = Infinity

    for (const id of panelIdsRef.current) {
      if (id === focusedId) continue
      const r = positionsRef.current[id]
      if (!r) continue
      const cx = r.x + r.w / 2
      const cy = r.y + r.h / 2

      // Filter by direction
      const ok =
        (dir === 'right' && cx > fromCx) ||
        (dir === 'left' && cx < fromCx) ||
        (dir === 'down' && cy > fromCy) ||
        (dir === 'up' && cy < fromCy)
      if (!ok) continue

      const dist = Math.hypot(cx - fromCx, cy - fromCy)
      if (dist < bestDist) {
        bestDist = dist
        bestId = id
      }
    }

    if (bestId) {
      setFocusedCardId(bestId)
      handleBringToFront(bestId)
      // Smooth animated pan to the target tile
      panToTileRef.current(bestId)
    }
  }

  // --- Tidy / auto-arrange ---
  function handleTidySelection(): void {
    const ids =
      selectedIdsRef.current.size > 0
        ? Array.from(selectedIdsRef.current)
        : [...panelIdsRef.current]
    if (ids.length === 0) return

    const cols = Math.ceil(Math.sqrt(ids.length))
    const gap = GRID_CELL

    // Get average tile size
    let avgW = DEFAULT_W,
      avgH = DEFAULT_H
    let sumW = 0,
      sumH = 0,
      count = 0
    for (const id of ids) {
      const r = positionsRef.current[id]
      if (r) {
        sumW += r.w
        sumH += r.h
        count++
      }
    }
    if (count > 0) {
      avgW = sumW / count
      avgH = sumH / count
    }

    // Compute bounding box center of current positions
    let cxSum = 0,
      cySum = 0
    for (const id of ids) {
      const r = positionsRef.current[id]
      if (r) {
        cxSum += r.x + r.w / 2
        cySum += r.y + r.h / 2
      }
    }
    const centerX = cxSum / ids.length
    const centerY = cySum / ids.length

    const totalW = cols * avgW + (cols - 1) * gap
    const rows = Math.ceil(ids.length / cols)
    const totalH = rows * avgH + (rows - 1) * gap
    const startX = snapToGrid(centerX - totalW / 2)
    const startY = snapToGrid(centerY - totalH / 2)

    setPositions((prev) => {
      const next = { ...prev }
      ids.forEach((id, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = snapToGrid(startX + col * (avgW + gap))
        const y = snapToGrid(startY + row * (avgH + gap))
        next[id] = { ...next[id], x, y }
      })
      positionsRef.current = next
      triggerSave(panelIdsRef.current, next)
      return next
    })
  }

  // --- Duplicate tile ---
  function handleDuplicateTile(id: string): void {
    const pm = usePanelStore.getState().panels[id]
    const rect = positionsRef.current[id]
    if (!pm || !rect) return

    const newId = crypto.randomUUID()
    const title = (pm.title || 'Terminal') + ' (copy)'
    addPanel(newId, title, pm.color, pm.type, pm.filePath, pm.initialCommand)

    const { x, y } = findNonOverlappingPosition(
      rect.x + 30,
      rect.y + 30,
      rect.w,
      rect.h,
      positionsRef.current
    )
    const newZ = ++topZRef.current
    const newRect: CardRect = { x, y, w: rect.w, h: rect.h, z: newZ }

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
    setFocusedCardId(newId)
    requestAnimationFrame(() => panToTileRef.current(newId))
  }

  function handleToggleMaximize(id: string): void {
    setMaximizedId((prev) => {
      if (prev === id) return null
      setFocusedCardId(id)
      return id
    })
  }
  handleToggleMaximizeRef.current = handleToggleMaximize

  function handleCreateTerminal(termName: string, termCommand: string, termCwd?: string): void {
    const newId = crypto.randomUUID()
    const initialCommand = termCommand || undefined
    addPanel(
      newId,
      termName || 'Terminal',
      colors.bgCard,
      'terminal',
      undefined,
      initialCommand,
      termCwd
    )

    const viewport = viewportRef.current
    const scale = scaleRef.current
    let idealX = 40
    let idealY = 40
    if (viewport) {
      const vw = viewport.clientWidth
      const vh = viewport.clientHeight
      idealX = (vw / 2 - canvasXRef.current) / scale - DEFAULT_W / 2
      idealY = (vh / 2 - canvasYRef.current) / scale - DEFAULT_H / 2
    }

    const { x, y } = findNonOverlappingPosition(
      idealX,
      idealY,
      DEFAULT_W,
      DEFAULT_H,
      positionsRef.current
    )
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
    setFocusedCardId(newId)
    // Animate canvas to center on the new tile
    requestAnimationFrame(() => panToTileRef.current(newId))
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

  function handleResizeWithMove(id: string, x: number, y: number, w: number, h: number): void {
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
      <CanvasToolbar
        onNewTerminal={() => setShowNewTerminal(true)}
        onNewNote={() => handleAddNote()}
      />
      {showNewTerminal && (
        <NewTerminalModal
          onCreateTerminal={handleCreateTerminal}
          onDismiss={() => setShowNewTerminal(false)}
        />
      )}
      <div
        ref={viewportRef}
        className="terminal-canvas-viewport"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          viewportRef.current?.classList.add('canvas-drop-target')
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
            viewportRef.current?.classList.remove('canvas-drop-target')
          }
        }}
        onDrop={(e) => {
          e.preventDefault()
          viewportRef.current?.classList.remove('canvas-drop-target')

          const vpRect = viewportRef.current!.getBoundingClientRect()
          const scale = scaleRef.current
          const baseCx = (e.clientX - vpRect.left - canvasXRef.current) / scale
          const baseCy = (e.clientY - vpRect.top - canvasYRef.current) / scale

          // Internal drag from sidebar
          const raw = e.dataTransfer.getData('application/x-multiterm-file')
          if (raw) {
            const data = JSON.parse(raw) as { path: string; name: string; isDir: boolean }
            if (data.isDir) return
            const tileType = inferTileType(data.path)
            if (tileType === 'image') {
              handleAddImage(data.path, baseCx, baseCy)
            } else {
              handleOpenFileAt(data.path, baseCx, baseCy)
            }
            return
          }

          // Native file drop from Finder/desktop
          const files = e.dataTransfer.files
          if (files.length > 0) {
            for (let i = 0; i < files.length; i++) {
              const file = files[i]
              const filePath = (file as File & { path?: string }).path
              if (!filePath) continue
              const offsetX = baseCx + i * 30
              const offsetY = baseCy + i * 30
              const tileType = inferTileType(filePath)
              if (tileType === 'image') {
                handleAddImage(filePath, offsetX, offsetY)
              } else {
                handleOpenFileAt(filePath, offsetX, offsetY)
              }
            }
          }
        }}
      >
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
                focused={focusedCardId === id}
                type={pm?.type ?? 'terminal'}
                filePath={pm?.filePath}
                onSelect={handleCardSelect}
                onFocusCard={setFocusedCardId}
                onMove={handleMove}
                onResize={handleResize}
                onResizeWithMove={handleResizeWithMove}
                onBringToFront={handleBringToFront}
                onClose={handleClosePanel}
                maximized={maximizedId === id}
                onToggleMaximize={handleToggleMaximize}
                onGroupDragContext={getGroupDragContext}
                onGroupMove={handleGroupMove}
                onCenterTile={(id) => panToTileRef.current(id)}
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
                Double-click the canvas or right-click for <strong>New terminal</strong> or{' '}
                <strong>New note</strong>
              </p>
            </div>
          </div>
        )}
      </div>
      {modal && (
        <PanelModal type={modal.type} cardId={modal.cardId} onDismiss={() => setModal(null)} />
      )}
    </div>
  )
}
