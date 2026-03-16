import { describe, test, expect, vi, beforeEach } from 'vitest'

/**
 * ATTN-03: Native OS notification appears when app is backgrounded
 *
 * Tests for handleAttentionEvent from src/main/attentionService.ts
 */

// --- Hoist notification mock refs so they are available inside vi.mock() factory ---
const { MockNotification, mockNotificationInstance } = vi.hoisted(() => {
  const mockNotificationInstance = {
    on: vi.fn(),
    show: vi.fn()
  }
  const MockNotification = vi.fn(() => mockNotificationInstance)
  return { MockNotification, mockNotificationInstance }
})

vi.mock('electron', () => ({
  Notification: MockNotification
}))

// --- Mock BrowserWindow ---
const mockWin = {
  webContents: { send: vi.fn() },
  isFocused: vi.fn(),
  show: vi.fn(),
  focus: vi.fn()
}

// --- Import after mocks ---
import { handleAttentionEvent } from '../../src/main/attentionService'

describe('handleAttentionEvent (ATTN-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates and shows Notification when win.isFocused() is false', () => {
    mockWin.isFocused.mockReturnValue(false)

    handleAttentionEvent(mockWin as never, 'session-1', 'My Terminal', 'Do you want to continue?')

    expect(MockNotification).toHaveBeenCalledOnce()
    expect(mockNotificationInstance.show).toHaveBeenCalledOnce()
  })

  test('Notification has title containing panel title', () => {
    mockWin.isFocused.mockReturnValue(false)

    handleAttentionEvent(mockWin as never, 'session-1', 'Build Panel', 'Do you want to continue?')

    const callArgs = MockNotification.mock.calls[0][0]
    expect(callArgs.title).toContain('Build Panel')
  })

  test('Notification has body containing snippet', () => {
    mockWin.isFocused.mockReturnValue(false)
    const snippet = 'Do you want to continue? (y/N)'

    handleAttentionEvent(mockWin as never, 'session-1', 'Terminal', snippet)

    const callArgs = MockNotification.mock.calls[0][0]
    expect(callArgs.body).toBe(snippet)
  })

  test('does NOT create Notification when win.isFocused() is true', () => {
    mockWin.isFocused.mockReturnValue(true)

    handleAttentionEvent(mockWin as never, 'session-1', 'Terminal', 'Do you want to continue?')

    expect(MockNotification).not.toHaveBeenCalled()
    expect(mockNotificationInstance.show).not.toHaveBeenCalled()
  })

  test('Notification click handler calls win.show()', () => {
    mockWin.isFocused.mockReturnValue(false)

    handleAttentionEvent(mockWin as never, 'session-1', 'Terminal', 'confirm?')

    // Find the click handler registered via n.on('click', handler)
    const onCall = mockNotificationInstance.on.mock.calls.find((c) => c[0] === 'click')
    expect(onCall).toBeDefined()
    const clickHandler = onCall![1]

    clickHandler()

    expect(mockWin.show).toHaveBeenCalledOnce()
  })

  test('Notification click handler calls win.focus()', () => {
    mockWin.isFocused.mockReturnValue(false)

    handleAttentionEvent(mockWin as never, 'session-2', 'Terminal', 'confirm?')

    const onCall = mockNotificationInstance.on.mock.calls.find((c) => c[0] === 'click')
    const clickHandler = onCall![1]

    clickHandler()

    expect(mockWin.focus).toHaveBeenCalledOnce()
  })

  test('Notification click handler sends panel:focus IPC with sessionId', () => {
    mockWin.isFocused.mockReturnValue(false)

    handleAttentionEvent(mockWin as never, 'session-abc', 'Terminal', 'confirm?')

    const onCall = mockNotificationInstance.on.mock.calls.find((c) => c[0] === 'click')
    const clickHandler = onCall![1]

    clickHandler()

    expect(mockWin.webContents.send).toHaveBeenCalledWith('panel:focus', 'session-abc')
  })
})
