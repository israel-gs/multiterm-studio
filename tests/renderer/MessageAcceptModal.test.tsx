import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from 'react'

/**
 * MessageAcceptModal — pending bridge message list tests
 *
 * Covers:
 * - Renders pending messages from bridgeStore for a given paneId
 * - Each row shows sender alias (or paneId), kind badge, body text, Accept/Decline buttons
 * - For kind === 'send', a textarea for response text is shown next to Accept
 * - Clicking Accept calls window.electronAPI.bridgeAccept(messageId, responseText || undefined)
 * - Clicking Decline calls window.electronAPI.bridgeDecline(messageId)
 * - For kind === 'notify', only Accept is shown (no Decline)
 * - Modal closes (unmounts) when there are zero pending messages left
 */

// ── vi.hoisted ensures these refs are initialized before vi.mock runs ──────────

const { state, mockBridgeMessageResolved, mockBridgePendingClear } = vi.hoisted(() => {
  // Use an object so we can mutate .pendingByPane without reassigning the variable
  // (vi.mock closures capture the variable, but reassignment requires the var to be
  //  captured by reference in the hoisted scope — using a mutable wrapper avoids it).
  const state = {
    pendingByPane: {} as Record<
      string,
      Array<{
        messageId: string
        fromPane: string
        fromAlias: string | null
        body: string
        kind: 'send' | 'notify'
        createdAt: number
      }>
    >
  }
  return {
    state,
    mockBridgeMessageResolved: vi.fn(),
    mockBridgePendingClear: vi.fn()
  }
})

// ── Mock bridgeStore ───────────────────────────────────────────────────────────

vi.mock('@renderer/store/bridgeStore', () => ({
  useBridgeStore: (
    selector: (s: {
      pendingByPane: Record<string, unknown[]>
      bridgeMessageResolved: ReturnType<typeof vi.fn>
      bridgePendingClear: ReturnType<typeof vi.fn>
    }) => unknown
  ) =>
    selector({
      pendingByPane: state.pendingByPane,
      bridgeMessageResolved: mockBridgeMessageResolved,
      bridgePendingClear: mockBridgePendingClear
    }),
  getPendingCount: (paneId: string) => state.pendingByPane[paneId]?.length ?? 0,
  getPendingMessages: (paneId: string) => state.pendingByPane[paneId] ?? []
}))

// ── Mock electronAPI ───────────────────────────────────────────────────────────

const mockBridgeAccept = vi.fn()
const mockBridgeDecline = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: {
    bridgeAccept: mockBridgeAccept,
    bridgeDecline: mockBridgeDecline
  },
  writable: true,
  configurable: true
})

// ── Import component ──────────────────────────────────────────────────────────

import { MessageAcceptModal } from '@renderer/components/MessageAcceptModal'

// ── Test data ─────────────────────────────────────────────────────────────────

const SEND_MSG = {
  messageId: 'msg-1',
  fromPane: 'pane-b',
  fromAlias: '@reviewer',
  body: 'Please approve this change',
  kind: 'send' as const,
  createdAt: 1000
}

const NOTIFY_MSG = {
  messageId: 'msg-2',
  fromPane: 'pane-c',
  fromAlias: null,
  body: 'Build finished',
  kind: 'notify' as const,
  createdAt: 2000
}

function setPending(paneId: string, msgs: (typeof SEND_MSG)[]): void {
  // Mutate the object in-place so the closure in the mock factory sees the change.
  Object.keys(state.pendingByPane).forEach((k) => delete state.pendingByPane[k])
  state.pendingByPane[paneId] = msgs
}

// ─────────────────────────────────────────────────────────────────────────────

describe('MessageAcceptModal — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(state.pendingByPane).forEach((k) => delete state.pendingByPane[k])
    mockBridgeAccept.mockResolvedValue(undefined)
    mockBridgeDecline.mockResolvedValue(undefined)
  })

  it('renders pending message body', () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByText('Please approve this change')).toBeTruthy()
  })

  it('shows the fromAlias when present', () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByText('@reviewer')).toBeTruthy()
  })

  it('falls back to fromPane when fromAlias is null', () => {
    setPending('pane-a', [NOTIFY_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByText('pane-c')).toBeTruthy()
  })

  it('shows "send" kind badge', () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByText('send')).toBeTruthy()
  })

  it('shows "notify" kind badge', () => {
    setPending('pane-a', [NOTIFY_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByText('notify')).toBeTruthy()
  })

  it('renders multiple pending messages', () => {
    setPending('pane-a', [
      SEND_MSG,
      { ...NOTIFY_MSG, messageId: 'msg-3', body: 'Another notification' }
    ])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByText('Please approve this change')).toBeTruthy()
    expect(screen.getByText('Another notification')).toBeTruthy()
  })
})

describe('MessageAcceptModal — send kind controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(state.pendingByPane).forEach((k) => delete state.pendingByPane[k])
    mockBridgeAccept.mockResolvedValue(undefined)
    mockBridgeDecline.mockResolvedValue(undefined)
  })

  it('shows a response textarea for kind === "send"', () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.getByRole('textbox')).toBeTruthy()
  })

  it('shows an Accept button for kind === "send"', () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const acceptBtns = screen.getAllByRole('button', { name: /accept/i })
    expect(acceptBtns.length).toBeGreaterThan(0)
  })

  it('shows a Decline button for kind === "send"', () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const declineBtns = screen.getAllByRole('button', { name: /decline/i })
    expect(declineBtns.length).toBeGreaterThan(0)
  })

  it('clicking Accept calls bridgeAccept with messageId and empty response as undefined', async () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const acceptBtn = screen.getByRole('button', { name: /accept/i })
    fireEvent.click(acceptBtn)
    await waitFor(() => {
      expect(mockBridgeAccept).toHaveBeenCalledWith('msg-1', undefined)
    })
  })

  it('clicking Accept with response text passes the text to bridgeAccept', async () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Looks good!' } })
    const acceptBtn = screen.getByRole('button', { name: /accept/i })
    fireEvent.click(acceptBtn)
    await waitFor(() => {
      expect(mockBridgeAccept).toHaveBeenCalledWith('msg-1', 'Looks good!')
    })
  })

  it('clicking Decline calls bridgeDecline with the messageId', async () => {
    setPending('pane-a', [SEND_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const declineBtn = screen.getByRole('button', { name: /decline/i })
    fireEvent.click(declineBtn)
    await waitFor(() => {
      expect(mockBridgeDecline).toHaveBeenCalledWith('msg-1')
    })
  })
})

describe('MessageAcceptModal — notify kind controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(state.pendingByPane).forEach((k) => delete state.pendingByPane[k])
    mockBridgeAccept.mockResolvedValue(undefined)
    mockBridgeDecline.mockResolvedValue(undefined)
  })

  it('does NOT show a response textarea for kind === "notify"', () => {
    setPending('pane-a', [NOTIFY_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows an Accept button for kind === "notify"', () => {
    setPending('pane-a', [NOTIFY_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const acceptBtns = screen.getAllByRole('button', { name: /accept/i })
    expect(acceptBtns.length).toBeGreaterThan(0)
  })

  it('does NOT show a Decline button for kind === "notify"', () => {
    setPending('pane-a', [NOTIFY_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /decline/i })).toBeNull()
  })

  it('clicking Accept on a notify message calls bridgeAccept with messageId', async () => {
    setPending('pane-a', [NOTIFY_MSG])
    render(<MessageAcceptModal paneId="pane-a" onClose={vi.fn()} />)
    const acceptBtn = screen.getByRole('button', { name: /accept/i })
    fireEvent.click(acceptBtn)
    await waitFor(() => {
      expect(mockBridgeAccept).toHaveBeenCalledWith('msg-2', undefined)
    })
  })
})
