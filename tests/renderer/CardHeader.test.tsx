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
    // Add a test panel with defaults (title='Terminal', color='#569cd6')
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

  it('double-click title enters edit mode', () => {
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const titleSpan = screen.getByText('Terminal')
    act(() => {
      fireEvent.dblClick(titleSpan)
    })

    const input = screen.queryByRole('textbox')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('Terminal')
  })

  it('blur saves title to store', () => {
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    // Enter edit mode
    const titleSpan = screen.getByText('Terminal')
    act(() => {
      fireEvent.dblClick(titleSpan)
    })

    const input = screen.getByRole('textbox') as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'New Title' } })
      fireEvent.blur(input)
    })

    // Input should be gone
    expect(screen.queryByRole('textbox')).toBeNull()
    // Store should have updated title
    const stored = usePanelStore.getState().panels[TEST_SESSION_ID]
    expect(stored.title).toBe('New Title')
  })

  it('Enter key triggers blur/save', () => {
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    // Enter edit mode
    const titleSpan = screen.getByText('Terminal')
    act(() => {
      fireEvent.dblClick(titleSpan)
    })

    const input = screen.getByRole('textbox')
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    // Edit mode should exit (input gone)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('header background reflects panel color', () => {
    usePanelStore.getState().setColor(TEST_SESSION_ID, '#f44747')
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const header = document.querySelector('.panel-header') as HTMLElement
    expect(header.style.background).toBe('rgb(244, 71, 71)')
  })

  it('right-click opens color context menu, clicking option changes color', () => {
    render(<CardHeader sessionId={TEST_SESSION_ID} onClose={mockOnClose} />)

    const header = document.querySelector('.panel-header') as HTMLElement
    act(() => {
      fireEvent.contextMenu(header)
    })

    // Context menu should appear with color options
    const greenOption = screen.getByLabelText('Set color to #6a9955')
    act(() => {
      fireEvent.click(greenOption)
    })

    const stored = usePanelStore.getState().panels[TEST_SESSION_ID]
    expect(stored.color).toBe('#6a9955')
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
