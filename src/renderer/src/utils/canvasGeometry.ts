import type { CardRect } from '../components/FloatingCard'

/**
 * Geometry for the infinite canvas.
 *
 * These were inline in TerminalCanvas, where none of them could be tested: the
 * spiral placement search, the z-index compaction and the fit-to-viewport maths
 * are the fiddliest parts of that component and the easiest to get subtly wrong.
 */

export const GRID_CELL = 24
export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 3.0

/** Padding left around the tiles when fitting them to the viewport. */
const FIT_PADDING = 60

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Rounds a coordinate onto the canvas grid. */
export function snapToGrid(v: number): number {
  return Math.round(v / GRID_CELL) * GRID_CELL
}

/** Clamps a zoom factor into the supported range. */
export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

/**
 * Rewrites z so the tiles are numbered 1..n in their current stacking order.
 *
 * Raising a tile increments a counter forever; compacting on save keeps the
 * numbers from growing without bound across sessions.
 */
export function normalizeZIndices(positions: Record<string, CardRect>): Record<string, CardRect> {
  const entries = Object.entries(positions).sort(([, a], [, b]) => a.z - b.z)
  const result: Record<string, CardRect> = {}
  entries.forEach(([id, rect], i) => {
    result[id] = { ...rect, z: i + 1 }
  })
  return result
}

/** Bounding box of the given tiles, or null when none of them exist. */
export function boundsOf(ids: string[], positions: Record<string, CardRect>): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const id of ids) {
    const r = positions[id]
    if (!r) continue
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.w)
    maxY = Math.max(maxY, r.y + r.h)
  }

  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null
}

/**
 * Viewport transform that frames `bounds`, centred and clamped to the zoom
 * range. Returns the scale and the pan offsets the canvas should adopt.
 */
export function fitToViewport(
  bounds: Bounds,
  viewportWidth: number,
  viewportHeight: number
): { scale: number; panX: number; panY: number } {
  const bboxW = bounds.maxX - bounds.minX
  const bboxH = bounds.maxY - bounds.minY

  // A single tile can be zero-width in one axis; fall back to max zoom rather
  // than dividing by zero.
  const scaleX = bboxW > 0 ? (viewportWidth - FIT_PADDING * 2) / bboxW : MAX_ZOOM
  const scaleY = bboxH > 0 ? (viewportHeight - FIT_PADDING * 2) / bboxH : MAX_ZOOM
  const scale = Math.min(clampZoom(scaleX), clampZoom(scaleY))

  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2

  return {
    scale,
    panX: viewportWidth / 2 - cx * scale,
    panY: viewportHeight / 2 - cy * scale
  }
}

/**
 * Finds a spot for a new tile that does not overlap the existing ones.
 *
 * Starts at the requested position and spirals outward in grid steps. Falls
 * back to a small offset from the ideal spot when the canvas is too crowded to
 * find a free one.
 */
export function findNonOverlappingPosition(
  idealX: number,
  idealY: number,
  w: number,
  h: number,
  positions: Record<string, CardRect>
): { x: number; y: number } {
  const gap = GRID_CELL
  const rects = Object.values(positions)

  function overlaps(x: number, y: number): boolean {
    return rects.some(
      (r) => x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y
    )
  }

  if (!overlaps(snapToGrid(idealX), snapToGrid(idealY))) {
    return { x: snapToGrid(idealX), y: snapToGrid(idealY) }
  }

  // Eight directions per ring, nearest ring first.
  const step = GRID_CELL * 2
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [-1, 0],
    [0, -1],
    [-1, 1],
    [1, -1],
    [-1, -1]
  ]

  for (let radius = 1; radius <= 20; radius++) {
    const offset = radius * step
    for (const [dx, dy] of directions) {
      const x = snapToGrid(idealX + dx * offset)
      const y = snapToGrid(idealY + dy * offset)
      if (!overlaps(x, y)) return { x, y }
    }
  }

  return { x: snapToGrid(idealX + GRID_CELL * 2), y: snapToGrid(idealY + GRID_CELL * 2) }
}

export interface MinimapTransform {
  minX: number
  minY: number
  mScale: number
  offsetX: number
  offsetY: number
}

/**
 * Maps world coordinates into the minimap.
 *
 * Shared by the drawing code and by click-to-navigate, which has to invert it —
 * they must agree or clicking the minimap jumps somewhere else.
 */
export function computeMinimapTransform(
  worldBounds: Bounds,
  minimapWidth: number,
  minimapHeight: number,
  padding = 8
): MinimapTransform {
  const worldW = Math.max(1, worldBounds.maxX - worldBounds.minX)
  const worldH = Math.max(1, worldBounds.maxY - worldBounds.minY)
  const mScale = Math.min(
    (minimapWidth - padding * 2) / worldW,
    (minimapHeight - padding * 2) / worldH
  )

  return {
    minX: worldBounds.minX,
    minY: worldBounds.minY,
    mScale,
    offsetX: (minimapWidth - worldW * mScale) / 2,
    offsetY: (minimapHeight - worldH * mScale) / 2
  }
}

/** World coordinates for a point clicked on the minimap. */
export function minimapPointToWorld(
  pointX: number,
  pointY: number,
  t: MinimapTransform
): { x: number; y: number } {
  return {
    x: (pointX - t.offsetX) / t.mScale + t.minX,
    y: (pointY - t.offsetY) / t.mScale + t.minY
  }
}
