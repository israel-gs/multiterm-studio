import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

// --- Mock window.electronAPI ---

const mockElectronAPI = {
  ptyCreate: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  onPtyData: vi.fn().mockReturnValue(vi.fn()),
  layoutSave: vi.fn().mockResolvedValue(undefined)
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

// Mock TerminalPanel to avoid xterm.js in tests
vi.mock('@renderer/components/Terminal', () => ({
  TerminalPanel: vi.fn(({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-${sessionId}`} />
  ))
}))

// Mock xterm CSS
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// vi.hoisted() required so mockScheduleSave is initialized before vi.mock() factory executes
const { mockScheduleSave } = vi.hoisted(() => ({ mockScheduleSave: vi.fn() }))

// Mock layoutPersistence to isolate timer behavior
vi.mock('@renderer/utils/layoutPersistence', () => ({
  scheduleSave: mockScheduleSave
}))

// --- Import component under test AFTER mocks ---
import { TerminalGrid } from '@renderer/components/TerminalGrid'
import { usePanelStore } from '@renderer/store/panelStore'

// --- Tests ---

describe('TerminalGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockElectronAPI.ptyKill.mockResolvedValue(undefined)
    mockElectronAPI.ptyCreate.mockResolvedValue(undefined)
    mockElectronAPI.onPtyData.mockReturnValue(vi.fn())
    // Reset panelStore between tests
    usePanelStore.setState({ panels: {} })
  })

  it('renders initial panel — grid appears with one terminal card', () => {
    act(() => {
      render(<TerminalGrid />)
    })
    // Should have exactly one terminal card
    const cards = document.querySelectorAll('.terminal-card')
    expect(cards).toHaveLength(1)
  })

  it('add panel creates a new terminal card', () => {
    act(() => {
      render(<TerminalGrid />)
    })

    // Find and click the "+ New terminal" button in the toolbar
    const addButton = screen.getAllByRole('button', { name: /new terminal/i })[0]
    act(() => {
      addButton.click()
    })

    // Should now have 2 terminal cards
    const cards = document.querySelectorAll('.terminal-card')
    expect(cards).toHaveLength(2)
  })

  it('close panel calls ptyKill and removes the card', () => {
    act(() => {
      render(<TerminalGrid />)
    })

    // Find the close button on the card
    const closeBtn = screen.getByTitle(/close/i)
    act(() => {
      closeBtn.click()
    })

    expect(mockElectronAPI.ptyKill).toHaveBeenCalled()
    // Should now show zero-state (no terminal cards)
    const cards = document.querySelectorAll('.terminal-card')
    expect(cards).toHaveLength(0)
  })

  it('when savedLayout prop is null, TerminalGrid creates a single panel', () => {
    act(() => {
      render(<TerminalGrid savedLayout={null} />)
    })
    const cards = document.querySelectorAll('.terminal-card')
    expect(cards).toHaveLength(1)
  })

  it('when savedLayout has panels, TerminalGrid restores them with correct metadata', () => {
    const savedLayout = {
      version: 2,
      panelIds: ['panel-x', 'panel-y'],
      panels: [
        { id: 'panel-x', title: 'Build', color: '#f44747' },
        { id: 'panel-y', title: 'Test', color: '#4ec9b0' }
      ]
    }

    act(() => {
      render(<TerminalGrid savedLayout={savedLayout} />)
    })

    // Should show both panels
    const cards = document.querySelectorAll('.terminal-card')
    expect(cards).toHaveLength(2)

    // Panel store should have both panels with correct metadata
    const panels = usePanelStore.getState().panels
    expect(panels['panel-x']).toEqual({ title: 'Build', color: '#f44747', attention: false })
    expect(panels['panel-y']).toEqual({ title: 'Test', color: '#4ec9b0', attention: false })
  })

  it('v1 layout with tree is migrated and panels are restored', () => {
    const savedLayout = {
      version: 1,
      tree: {
        type: 'split',
        direction: 'row',
        children: ['panel-a', 'panel-b'],
        splitPercentages: [50, 50]
      },
      panels: [
        { id: 'panel-a', title: 'Shell', color: '#569cd6' },
        { id: 'panel-b', title: 'Git', color: '#6a9955' }
      ]
    }

    act(() => {
      render(<TerminalGrid savedLayout={savedLayout} />)
    })

    const cards = document.querySelectorAll('.terminal-card')
    expect(cards).toHaveLength(2)

    const panels = usePanelStore.getState().panels
    expect(panels['panel-a']).toEqual({ title: 'Shell', color: '#569cd6', attention: false })
    expect(panels['panel-b']).toEqual({ title: 'Git', color: '#6a9955', attention: false })
  })
})
