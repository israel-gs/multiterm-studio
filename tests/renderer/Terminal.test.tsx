import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import React from 'react'

// --- Hoisted mock refs (available inside vi.mock factory) ---

const { mockTerm, mockFitAddon, mockWebLinksAddon, MockTerminalConstructor } = vi.hoisted(() => {
  const mockTerm = {
    loadAddon: vi.fn(),
    open: vi.fn(),
    onData: vi.fn(),
    write: vi.fn(),
    dispose: vi.fn(),
    cols: 80,
    rows: 24
  }
  const mockFitAddon = { fit: vi.fn() }
  const mockWebLinksAddon = {}
  const MockTerminalConstructor = vi.fn(() => mockTerm)
  return { mockTerm, mockFitAddon, mockWebLinksAddon, MockTerminalConstructor }
})

// --- Module mocks ---

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminalConstructor
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(() => mockFitAddon)
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(() => mockWebLinksAddon)
}))

// Mock xterm.css import (no-op in tests)
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// --- Mock ResizeObserver ---

const mockObserve = vi.fn()
const mockDisconnect = vi.fn()

global.ResizeObserver = vi.fn((_cb) => ({
  observe: mockObserve,
  disconnect: mockDisconnect
}))

// --- Mock window.electronAPI ---

const mockElectronAPI = {
  ptyCreate: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  onPtyData: vi.fn().mockReturnValue(vi.fn())
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

// --- Import the component under test ---
import { TerminalPanel } from '@renderer/components/Terminal'

// --- Tests ---

describe('TerminalPanel', () => {
  const sessionId = 'test-session-id'
  const cwd = '/test/cwd'

  beforeEach(() => {
    vi.clearAllMocks()
    // Restore return values that clearAllMocks clears
    mockElectronAPI.ptyCreate.mockResolvedValue(undefined)
    mockElectronAPI.ptyWrite.mockResolvedValue(undefined)
    mockElectronAPI.ptyResize.mockResolvedValue(undefined)
    mockElectronAPI.ptyKill.mockResolvedValue(undefined)
    mockElectronAPI.onPtyData.mockReturnValue(vi.fn())
    MockTerminalConstructor.mockReturnValue(mockTerm)
  })

  it('creates xterm Terminal with scrollback: 10000', () => {
    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })
    expect(MockTerminalConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ scrollback: 10000 })
    )
  })

  it('creates xterm Terminal with cursorBlink: true', () => {
    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })
    expect(MockTerminalConstructor).toHaveBeenCalledWith(
      expect.objectContaining({ cursorBlink: true })
    )
  })

  it('loads FitAddon and WebLinksAddon via term.loadAddon', () => {
    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })
    expect(mockTerm.loadAddon).toHaveBeenCalledWith(mockFitAddon)
    expect(mockTerm.loadAddon).toHaveBeenCalledWith(mockWebLinksAddon)
  })

  it('calls term.open with the container ref element', () => {
    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })
    expect(mockTerm.open).toHaveBeenCalledWith(expect.any(HTMLElement))
  })

  it('calls fitAddon.fit() after term.open', () => {
    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })
    const openCallOrder = mockTerm.open.mock.invocationCallOrder[0]
    const fitCallOrder = mockFitAddon.fit.mock.invocationCallOrder[0]
    expect(openCallOrder).toBeLessThan(fitCallOrder)
    expect(mockFitAddon.fit).toHaveBeenCalled()
  })

  it('calls window.electronAPI.ptyCreate with sessionId and cwd', () => {
    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })
    expect(mockElectronAPI.ptyCreate).toHaveBeenCalledWith(sessionId, cwd)
  })

  it('calls window.electronAPI.ptyWrite when term.onData fires', () => {
    let dataCallback: ((data: string) => void) | null = null
    mockTerm.onData.mockImplementation((cb: (data: string) => void) => {
      dataCallback = cb
    })

    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })

    expect(dataCallback).not.toBeNull()
    act(() => {
      dataCallback!('test input')
    })
    expect(mockElectronAPI.ptyWrite).toHaveBeenCalledWith(sessionId, 'test input')
  })

  it('calls window.electronAPI.onPtyData and its callback calls term.write', () => {
    let ptyDataCallback: ((data: string) => void) | null = null
    mockElectronAPI.onPtyData.mockImplementation(
      (_id: string, cb: (data: string) => void) => {
        ptyDataCallback = cb
        return vi.fn()
      }
    )

    act(() => {
      render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
    })

    expect(mockElectronAPI.onPtyData).toHaveBeenCalledWith(sessionId, expect.any(Function))
    expect(ptyDataCallback).not.toBeNull()

    act(() => {
      ptyDataCallback!('shell output')
    })
    expect(mockTerm.write).toHaveBeenCalledWith('shell output')
  })

  it('calls ptyKill and term.dispose on cleanup', () => {
    const mockUnsubscribe = vi.fn()
    mockElectronAPI.onPtyData.mockReturnValue(mockUnsubscribe)

    let unmount: () => void
    act(() => {
      const result = render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
      unmount = result.unmount
    })

    act(() => {
      unmount()
    })

    expect(mockElectronAPI.ptyKill).toHaveBeenCalledWith(sessionId)
    expect(mockTerm.dispose).toHaveBeenCalled()
  })

  it('calls unsubscribe on cleanup', () => {
    const mockUnsubscribe = vi.fn()
    mockElectronAPI.onPtyData.mockReturnValue(mockUnsubscribe)

    let unmount: () => void
    act(() => {
      const result = render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
      unmount = result.unmount
    })

    act(() => {
      unmount()
    })

    expect(mockUnsubscribe).toHaveBeenCalled()
  })

  it('calls observer.disconnect on cleanup', () => {
    let unmount: () => void
    act(() => {
      const result = render(<TerminalPanel sessionId={sessionId} cwd={cwd} />)
      unmount = result.unmount
    })

    act(() => {
      unmount()
    })

    expect(mockDisconnect).toHaveBeenCalled()
  })
})
