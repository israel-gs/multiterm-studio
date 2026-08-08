import { describe, it, expect, beforeEach } from 'vitest'
import { useCanvasStore } from '@renderer/store/canvasStore'

describe('canvasStore', () => {
  beforeEach(() => {
    useCanvasStore.setState({
      tileOrder: [],
      focusedId: null,
      maximizedId: null,
      offscreenIds: new Set()
    })
  })

  it('keeps the same set object when the members have not changed', () => {
    // The canvas feeds this from its pan/zoom animation frame. A new object per
    // frame would re-render every subscriber while the canvas moves.
    useCanvasStore.getState().setOffscreenIds(new Set(['a', 'b']))
    const first = useCanvasStore.getState().offscreenIds

    useCanvasStore.getState().setOffscreenIds(new Set(['b', 'a']))

    expect(useCanvasStore.getState().offscreenIds).toBe(first)
  })

  it('replaces the set when a tile leaves the viewport', () => {
    useCanvasStore.getState().setOffscreenIds(new Set(['a']))
    useCanvasStore.getState().setOffscreenIds(new Set(['a', 'b']))

    expect([...useCanvasStore.getState().offscreenIds]).toEqual(['a', 'b'])
  })

  it('replaces the set when a tile comes back into view', () => {
    useCanvasStore.getState().setOffscreenIds(new Set(['a', 'b']))
    useCanvasStore.getState().setOffscreenIds(new Set(['a']))

    expect([...useCanvasStore.getState().offscreenIds]).toEqual(['a'])
  })

  it('empties the set', () => {
    useCanvasStore.getState().setOffscreenIds(new Set(['a']))
    useCanvasStore.getState().setOffscreenIds(new Set())

    expect(useCanvasStore.getState().offscreenIds.size).toBe(0)
  })

  it('mirrors the canvas view state', () => {
    useCanvasStore.getState().setTileOrder(['a', 'b'])
    useCanvasStore.getState().setFocusedId('b')
    useCanvasStore.getState().setMaximizedId('a')

    expect(useCanvasStore.getState().tileOrder).toEqual(['a', 'b'])
    expect(useCanvasStore.getState().focusedId).toBe('b')
    expect(useCanvasStore.getState().maximizedId).toBe('a')
  })
})
