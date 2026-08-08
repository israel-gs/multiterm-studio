import { describe, it, expect } from 'vitest'
import type { CardRect } from '@renderer/components/FloatingCard'
import {
  snapToGrid,
  clampZoom,
  normalizeZIndices,
  boundsOf,
  fitToViewport,
  findNonOverlappingPosition,
  computeMinimapTransform,
  minimapPointToWorld,
  GRID_CELL,
  MIN_ZOOM,
  MAX_ZOOM
} from '@renderer/utils/canvasGeometry'

const rect = (x: number, y: number, w = 100, h = 100, z = 1): CardRect => ({ x, y, w, h, z })

describe('snapToGrid', () => {
  it('rounds to the nearest cell', () => {
    expect(snapToGrid(0)).toBe(0)
    expect(snapToGrid(GRID_CELL - 1)).toBe(GRID_CELL)
    expect(snapToGrid(GRID_CELL / 2 - 1)).toBe(0)
  })

  it('handles negative coordinates', () => {
    expect(snapToGrid(-GRID_CELL + 1)).toBe(-GRID_CELL)
  })
})

describe('clampZoom', () => {
  it('keeps values inside the supported range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM)
  })
})

describe('normalizeZIndices', () => {
  it('renumbers from 1 while preserving stacking order', () => {
    const result = normalizeZIndices({
      a: rect(0, 0, 10, 10, 50),
      b: rect(0, 0, 10, 10, 7),
      c: rect(0, 0, 10, 10, 900)
    })

    expect(result.b.z).toBe(1)
    expect(result.a.z).toBe(2)
    expect(result.c.z).toBe(3)
  })

  it('leaves the geometry untouched', () => {
    const result = normalizeZIndices({ a: rect(5, 6, 7, 8, 3) })
    expect(result.a).toMatchObject({ x: 5, y: 6, w: 7, h: 8 })
  })

  it('handles an empty canvas', () => {
    expect(normalizeZIndices({})).toEqual({})
  })
})

describe('boundsOf', () => {
  it('spans every tile', () => {
    const positions = { a: rect(0, 0, 100, 50), b: rect(200, 300, 100, 50) }
    expect(boundsOf(['a', 'b'], positions)).toEqual({ minX: 0, minY: 0, maxX: 300, maxY: 350 })
  })

  it('ignores ids with no position', () => {
    const positions = { a: rect(10, 10, 10, 10) }
    expect(boundsOf(['a', 'ghost'], positions)).toEqual({
      minX: 10,
      minY: 10,
      maxX: 20,
      maxY: 20
    })
  })

  it('returns null when nothing resolves', () => {
    expect(boundsOf([], {})).toBeNull()
    expect(boundsOf(['ghost'], {})).toBeNull()
  })
})

describe('fitToViewport', () => {
  it('centres the bounds in the viewport', () => {
    const { scale, panX, panY } = fitToViewport(
      { minX: 0, minY: 0, maxX: 100, maxY: 100 },
      1000,
      1000
    )
    // Centre of the bounds must land in the centre of the viewport.
    expect(50 * scale + panX).toBeCloseTo(500)
    expect(50 * scale + panY).toBeCloseTo(500)
  })

  it('never exceeds the zoom limits', () => {
    const tiny = fitToViewport({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 1000, 1000)
    expect(tiny.scale).toBeLessThanOrEqual(MAX_ZOOM)

    const huge = fitToViewport({ minX: 0, minY: 0, maxX: 100000, maxY: 100000 }, 800, 600)
    expect(huge.scale).toBeGreaterThanOrEqual(MIN_ZOOM)
  })

  it('fits the constraining axis', () => {
    // Wide bounds in a square viewport: width decides the scale.
    const { scale } = fitToViewport({ minX: 0, minY: 0, maxX: 1000, maxY: 10 }, 500, 500)
    expect(scale).toBeCloseTo((500 - 120) / 1000)
  })

  it('does not divide by zero on a degenerate box', () => {
    const { scale } = fitToViewport({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 800, 600)
    expect(Number.isFinite(scale)).toBe(true)
    expect(scale).toBe(MAX_ZOOM)
  })
})

describe('findNonOverlappingPosition', () => {
  it('keeps the requested spot when it is free', () => {
    expect(findNonOverlappingPosition(240, 240, 100, 100, {})).toEqual({ x: 240, y: 240 })
  })

  it('snaps the requested spot to the grid', () => {
    const { x, y } = findNonOverlappingPosition(241, 241, 100, 100, {})
    expect(x % GRID_CELL).toBe(0)
    expect(y % GRID_CELL).toBe(0)
  })

  it('moves away from an occupied spot', () => {
    const positions = { a: rect(240, 240, 100, 100) }
    const spot = findNonOverlappingPosition(240, 240, 100, 100, positions)
    expect(spot).not.toEqual({ x: 240, y: 240 })
  })

  it('returns a spot that genuinely does not overlap', () => {
    // A cluster around the ideal point, forcing the search outward.
    const positions: Record<string, CardRect> = {}
    for (let i = 0; i < 12; i++) {
      positions[`t${i}`] = rect(240 + (i % 4) * 120, 240 + Math.floor(i / 4) * 120, 100, 100)
    }

    const spot = findNonOverlappingPosition(240, 240, 100, 100, positions)
    const gap = GRID_CELL
    for (const r of Object.values(positions)) {
      const hits =
        spot.x < r.x + r.w + gap &&
        spot.x + 100 + gap > r.x &&
        spot.y < r.y + r.h + gap &&
        spot.y + 100 + gap > r.y
      expect(hits).toBe(false)
    }
  })

  it('still returns a usable position when the canvas is saturated', () => {
    // Every ring the search inspects is occupied; it must not loop forever or
    // return something non-finite.
    const positions: Record<string, CardRect> = {}
    let i = 0
    for (let x = -1200; x <= 1200; x += 48) {
      for (let y = -1200; y <= 1200; y += 48) {
        positions[`t${i++}`] = rect(x, y, 100, 100)
      }
    }

    const spot = findNonOverlappingPosition(0, 0, 100, 100, positions)
    expect(Number.isFinite(spot.x)).toBe(true)
    expect(Number.isFinite(spot.y)).toBe(true)
  })
})

describe('minimap transform', () => {
  const bounds = { minX: -500, minY: -200, maxX: 1500, maxY: 800 }

  it('round-trips a point back to world coordinates', () => {
    const t = computeMinimapTransform(bounds, 160, 100)
    const worldX = 320
    const worldY = 140

    const px = (worldX - t.minX) * t.mScale + t.offsetX
    const py = (worldY - t.minY) * t.mScale + t.offsetY

    const back = minimapPointToWorld(px, py, t)
    expect(back.x).toBeCloseTo(worldX)
    expect(back.y).toBeCloseTo(worldY)
  })

  it('fits the world inside the minimap', () => {
    const t = computeMinimapTransform(bounds, 160, 100)
    const w = (bounds.maxX - bounds.minX) * t.mScale
    const h = (bounds.maxY - bounds.minY) * t.mScale

    expect(w).toBeLessThanOrEqual(160)
    expect(h).toBeLessThanOrEqual(100)
  })

  it('does not divide by zero on a degenerate world', () => {
    const t = computeMinimapTransform({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, 160, 100)
    expect(Number.isFinite(t.mScale)).toBe(true)
  })
})
