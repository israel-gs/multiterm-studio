import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * settingsManager — scrollback setting tests
 *
 * Tests getScrollbackBytes / setScrollbackBytes helpers added to support
 * the terminal.scrollbackBytes setting with clamping.
 *
 * Constants:
 *   SCROLLBACK_DEFAULT = 8 * 1024 * 1024   (8 MB)
 *   SCROLLBACK_MIN     = 16 * 1024          (16 KB)
 *   SCROLLBACK_MAX     = 64 * 1024 * 1024   (64 MB)
 */

// vi.hoisted() ensures mock refs are initialized before vi.mock() factory executes
const { mockWriteFileSync, mockReadFileSync, mockMkdirSync, mockRenameSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockRenameSync: vi.fn()
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync,
    renameSync: mockRenameSync
  },
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  renameSync: mockRenameSync
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-user-data')
  }
}))

import {
  initSettings,
  getScrollbackBytes,
  setScrollbackBytes,
  SCROLLBACK_DEFAULT,
  SCROLLBACK_MIN,
  SCROLLBACK_MAX
} from '../../src/main/settingsManager'

describe('settingsManager — scrollback constants', () => {
  it('SCROLLBACK_DEFAULT is 8 MB', () => {
    expect(SCROLLBACK_DEFAULT).toBe(8 * 1024 * 1024)
  })

  it('SCROLLBACK_MIN is 16 KB', () => {
    expect(SCROLLBACK_MIN).toBe(16 * 1024)
  })

  it('SCROLLBACK_MAX is 64 MB', () => {
    expect(SCROLLBACK_MAX).toBe(64 * 1024 * 1024)
  })
})

describe('settingsManager — getScrollbackBytes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Simulate empty settings file (no prior value)
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockWriteFileSync.mockReturnValue(undefined)
    mockMkdirSync.mockReturnValue(undefined)
    mockRenameSync.mockReturnValue(undefined)
    initSettings()
  })

  it('returns SCROLLBACK_DEFAULT when setting is unset', () => {
    expect(getScrollbackBytes()).toBe(SCROLLBACK_DEFAULT)
  })

  it('returns stored value when within valid range', () => {
    setScrollbackBytes(16 * 1024 * 1024) // 16 MB
    expect(getScrollbackBytes()).toBe(16 * 1024 * 1024)
  })

  it('clamps value below SCROLLBACK_MIN to SCROLLBACK_MIN', () => {
    setScrollbackBytes(1024) // 1 KB — below min
    expect(getScrollbackBytes()).toBe(SCROLLBACK_MIN)
  })

  it('clamps value above SCROLLBACK_MAX to SCROLLBACK_MAX', () => {
    setScrollbackBytes(128 * 1024 * 1024) // 128 MB — above max
    expect(getScrollbackBytes()).toBe(SCROLLBACK_MAX)
  })

  it('accepts exactly SCROLLBACK_MIN', () => {
    setScrollbackBytes(SCROLLBACK_MIN)
    expect(getScrollbackBytes()).toBe(SCROLLBACK_MIN)
  })

  it('accepts exactly SCROLLBACK_MAX', () => {
    setScrollbackBytes(SCROLLBACK_MAX)
    expect(getScrollbackBytes()).toBe(SCROLLBACK_MAX)
  })
})

describe('settingsManager — setScrollbackBytes persists to disk', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mockWriteFileSync.mockReturnValue(undefined)
    mockMkdirSync.mockReturnValue(undefined)
    mockRenameSync.mockReturnValue(undefined)
    initSettings()
  })

  it('calls writeFileSync when setting scrollback bytes', () => {
    setScrollbackBytes(4 * 1024 * 1024)
    expect(mockWriteFileSync).toHaveBeenCalled()
  })
})
