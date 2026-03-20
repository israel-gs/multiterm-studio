import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'
import { usePanelStore } from '@renderer/store/panelStore'

// Mock xterm CSS
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// --- Import after mocks ---
import { CardHeader } from '@renderer/components/CardHeader'

// --- Tests ---

describe('CardHeader', () => {
  const TEST_SESSION_ID = 'test-session-123'
  let mockOnClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockOnClose = vi.fn()
    // Reset zustand store between tests
    usePanelStore.setState({ panels: {} })
    // Add a test panel with defaults (title='Terminal', color='#1c1c1c')
    usePanelStore.getState().addPanel(TEST_SESSION_ID)
  })

  it('close button calls onClose prop', () => {
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const closeBtn = screen.getByTitle(/close/i)
    act(() => {
      fireEvent.click(closeBtn)
    })

    expect(mockOnClose).toHaveBeenCalled()
  })

  it('displays panel title from store', () => {
    usePanelStore.getState().setTitle(TEST_SESSION_ID, 'My Shell')
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    expect(screen.getByText('My Shell')).toBeTruthy()
  })

  it('header background reflects panel color', () => {
    usePanelStore.getState().setColor(TEST_SESSION_ID, '#f44747')
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const header = document.querySelector('.panel-header') as HTMLElement
    expect(header.style.background).toBe('rgb(244, 71, 71)')
  })

  it('renders attention-badge-inline when panel.attention is true', () => {
    usePanelStore.getState().setAttention(TEST_SESSION_ID)
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const badge = document.querySelector('.attention-badge-inline')
    expect(badge).not.toBeNull()
  })

  it('does NOT render attention-badge-inline when panel.attention is false (default)', () => {
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const badge = document.querySelector('.attention-badge-inline')
    expect(badge).toBeNull()
  })
})
