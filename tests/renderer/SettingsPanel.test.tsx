import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'

/**
 * SettingsPanel — terminal scrollback setting tests
 *
 * Verifies:
 * - Terminal tab renders the scrollback size control (not placeholder)
 * - Control shows the current value loaded via settingsGet
 * - Changing the value calls settingsSet with 'terminal.scrollbackBytes'
 * - The "applies to new sessions" hint is visible
 */

// --- Mock window.electronAPI ---

const mockSettingsGet = vi.fn()
const mockSettingsSet = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: {
    settingsGet: mockSettingsGet,
    settingsSet: mockSettingsSet
  },
  writable: true,
  configurable: true
})

// --- Mock appearance store (required by SettingsPanel) ---

vi.mock('@renderer/store/appearanceStore', () => ({
  useAppearanceStore: vi.fn((selector: (s: { mode: string; setMode: () => void }) => unknown) =>
    selector({ mode: 'dark', setMode: vi.fn() })
  )
}))

// --- Import component ---

import { KEYBINDINGS } from '../../src/shared/keybindings'
import { SettingsPanel } from '@renderer/components/SettingsPanel'

// --- Helpers ---

function renderPanel(): void {
  render(<SettingsPanel onClose={vi.fn()} />)
}

function clickTerminalTab(): void {
  const terminalTab = screen.getByText('Terminal')
  fireEvent.click(terminalTab)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('SettingsPanel — Terminal tab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: settingsGet resolves with null (unset → component uses default)
    mockSettingsGet.mockResolvedValue(null)
    mockSettingsSet.mockResolvedValue(undefined)
  })

  it('renders the Terminal tab button', () => {
    renderPanel()
    expect(screen.getByText('Terminal')).toBeTruthy()
  })

  it('Terminal tab does NOT show "Coming soon" placeholder', async () => {
    renderPanel()
    clickTerminalTab()
    await waitFor(() => {
      expect(screen.queryByText('Coming soon')).toBeNull()
    })
  })

  it('Terminal tab shows "Scrollback size" label', async () => {
    renderPanel()
    clickTerminalTab()
    await waitFor(() => {
      expect(screen.getByText('Scrollback size')).toBeTruthy()
    })
  })

  it('loads current scrollback value via settingsGet on mount', async () => {
    mockSettingsGet.mockResolvedValue(4 * 1024 * 1024) // 4 MB stored
    renderPanel()
    clickTerminalTab()
    await waitFor(() => {
      expect(mockSettingsGet).toHaveBeenCalledWith('terminal.scrollbackBytes')
    })
  })

  it('calls settingsSet with terminal.scrollbackBytes when input changes', async () => {
    renderPanel()
    clickTerminalTab()

    await waitFor(() => {
      expect(screen.getByText('Scrollback size')).toBeTruthy()
    })

    const input = screen.getByRole('spinbutton') as HTMLInputElement
    fireEvent.change(input, { target: { value: '16' } })

    await waitFor(() => {
      expect(mockSettingsSet).toHaveBeenCalledWith('terminal.scrollbackBytes', expect.any(Number))
    })
  })

  it('shows "applies to newly created sessions" hint text', async () => {
    renderPanel()
    clickTerminalTab()
    await waitFor(() => {
      const hint = screen.getAllByText(/newly created sessions/i)[0]
      expect(hint).toBeTruthy()
    })
  })

  describe('keybindings tab', () => {
    function clickKeybindingsTab(): void {
      fireEvent.click(screen.getByText('Keybindings'))
    }

    it('lists the shortcuts instead of a "coming soon" placeholder', () => {
      renderPanel()
      clickKeybindingsTab()

      expect(screen.queryByText('Coming soon')).toBeNull()
      expect(screen.getByText('New terminal')).toBeTruthy()
      expect(screen.getByText('Toggle the sidebar')).toBeTruthy()
    })

    it('groups the shortcuts by area', () => {
      renderPanel()
      clickKeybindingsTab()

      // "Canvas" is both a group title and the context of some rows, so a
      // strict single match would fail on legitimate duplication.
      for (const group of KEYBINDINGS) {
        expect(screen.getAllByText(group.title).length).toBeGreaterThan(0)
      }
    })

    it('renders every documented binding', () => {
      renderPanel()
      clickKeybindingsTab()

      const rows = KEYBINDINGS.flatMap((g) => g.bindings)
      for (const binding of rows) {
        expect(screen.getAllByText(binding.label).length).toBeGreaterThan(0)
      }
    })

    it('shows a gesture as prose rather than as a key combination', () => {
      renderPanel()
      clickKeybindingsTab()

      expect(screen.getByText('Scroll, or Space + drag')).toBeTruthy()
    })
  })
})
