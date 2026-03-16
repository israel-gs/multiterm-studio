import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock window.electronAPI
const mockLayoutSave = vi.fn().mockResolvedValue(undefined)

Object.defineProperty(window, 'electronAPI', {
  value: { layoutSave: mockLayoutSave },
  writable: true,
  configurable: true
})

import { scheduleSave } from '../../src/renderer/src/utils/layoutPersistence'

const folderPath = '/some/project'
const snapshot1 = { version: 1, tree: 'panel-a', panels: [{ id: 'panel-a', title: 'T1', color: '#fff' }] }
const snapshot2 = { version: 1, tree: 'panel-b', panels: [{ id: 'panel-b', title: 'T2', color: '#000' }] }

describe('layoutPersistence - scheduleSave debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calling scheduleSave once, then advancing 1000ms calls layoutSave exactly once', () => {
    scheduleSave(folderPath, snapshot1)
    vi.advanceTimersByTime(1000)
    expect(mockLayoutSave).toHaveBeenCalledTimes(1)
    expect(mockLayoutSave).toHaveBeenCalledWith(folderPath, snapshot1)
  })

  it('calling scheduleSave 5 times rapidly then advancing 1500ms fires layoutSave exactly once with last snapshot', () => {
    scheduleSave(folderPath, snapshot1)
    vi.advanceTimersByTime(100)
    scheduleSave(folderPath, snapshot1)
    vi.advanceTimersByTime(100)
    scheduleSave(folderPath, snapshot1)
    vi.advanceTimersByTime(100)
    scheduleSave(folderPath, snapshot1)
    vi.advanceTimersByTime(100)
    scheduleSave(folderPath, snapshot2) // last call — the one that should fire
    vi.advanceTimersByTime(1500)
    expect(mockLayoutSave).toHaveBeenCalledTimes(1)
    expect(mockLayoutSave).toHaveBeenCalledWith(folderPath, snapshot2)
  })

  it('calling scheduleSave, waiting 1000ms (fires), then calling again and waiting 1000ms fires twice total', () => {
    scheduleSave(folderPath, snapshot1)
    vi.advanceTimersByTime(1000)
    expect(mockLayoutSave).toHaveBeenCalledTimes(1)

    scheduleSave(folderPath, snapshot2)
    vi.advanceTimersByTime(1000)
    expect(mockLayoutSave).toHaveBeenCalledTimes(2)
    expect(mockLayoutSave).toHaveBeenNthCalledWith(2, folderPath, snapshot2)
  })
})
