import { describe, it, expect, beforeEach } from 'vitest'

/**
 * bridgeStore — pending-message state per pane
 *
 * Covers:
 * - Initial state: empty pendingByPane map
 * - bridgePendingReceived adds to the correct pane and increments count
 * - bridgeMessageResolved removes a message and decrements count
 * - bridgePendingClear empties a pane's list
 * - Selectors: getPendingCount and getPendingMessages
 * - Multi-pane isolation: mutations on pane A do not affect pane B
 */

// Reset module state between tests by re-importing a fresh store instance each time.
// Zustand stores are module-level singletons, so we use vi.resetModules() in beforeEach.
import { vi } from 'vitest'

let useBridgeStore: (typeof import('../../src/renderer/src/store/bridgeStore'))['useBridgeStore']
let getPendingCount: (typeof import('../../src/renderer/src/store/bridgeStore'))['getPendingCount']
let getPendingMessages: (typeof import('../../src/renderer/src/store/bridgeStore'))['getPendingMessages']

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('../../src/renderer/src/store/bridgeStore')
  useBridgeStore = mod.useBridgeStore
  getPendingCount = mod.getPendingCount
  getPendingMessages = mod.getPendingMessages
})

const MSG_A = {
  paneId: 'pane-a',
  messageId: 'msg-1',
  fromPane: 'pane-b',
  fromAlias: '@reviewer',
  body: 'hello',
  kind: 'send' as const,
  createdAt: 1000
}

const MSG_B = {
  paneId: 'pane-b',
  messageId: 'msg-2',
  fromPane: 'pane-a',
  fromAlias: null,
  body: 'notify body',
  kind: 'notify' as const,
  createdAt: 2000
}

describe('bridgeStore — initial state', () => {
  it('starts with an empty pendingByPane map', () => {
    const state = useBridgeStore.getState()
    expect(state.pendingByPane).toEqual({})
  })
})

describe('bridgeStore — bridgePendingReceived', () => {
  it('adds a message to the correct pane', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    const msgs = getPendingMessages('pane-a')
    expect(msgs).toHaveLength(1)
    expect(msgs[0].messageId).toBe('msg-1')
    expect(msgs[0].fromAlias).toBe('@reviewer')
    expect(msgs[0].kind).toBe('send')
  })

  it('increments the pending count for the target pane', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    expect(getPendingCount('pane-a')).toBe(1)
  })

  it('accumulates multiple messages for the same pane', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore
      .getState()
      .bridgePendingReceived({ ...MSG_A, messageId: 'msg-1b', createdAt: 1500 })
    expect(getPendingCount('pane-a')).toBe(2)
  })
})

describe('bridgeStore — multi-pane isolation', () => {
  it('events for pane-a do not affect pane-b count', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore.getState().bridgePendingReceived(MSG_B)
    expect(getPendingCount('pane-a')).toBe(1)
    expect(getPendingCount('pane-b')).toBe(1)
  })

  it('resolving a message in pane-a leaves pane-b untouched', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore.getState().bridgePendingReceived(MSG_B)
    useBridgeStore.getState().bridgeMessageResolved({ paneId: 'pane-a', messageId: 'msg-1' })
    expect(getPendingCount('pane-a')).toBe(0)
    expect(getPendingCount('pane-b')).toBe(1)
  })
})

describe('bridgeStore — bridgeMessageResolved', () => {
  it('removes the resolved message from the pane list', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore.getState().bridgeMessageResolved({ paneId: 'pane-a', messageId: 'msg-1' })
    expect(getPendingMessages('pane-a')).toHaveLength(0)
  })

  it('decrements count to zero after all messages are resolved', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore
      .getState()
      .bridgePendingReceived({ ...MSG_A, messageId: 'msg-1b', createdAt: 1500 })
    useBridgeStore.getState().bridgeMessageResolved({ paneId: 'pane-a', messageId: 'msg-1' })
    expect(getPendingCount('pane-a')).toBe(1)
    useBridgeStore.getState().bridgeMessageResolved({ paneId: 'pane-a', messageId: 'msg-1b' })
    expect(getPendingCount('pane-a')).toBe(0)
  })

  it('is a no-op for an unknown messageId', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore
      .getState()
      .bridgeMessageResolved({ paneId: 'pane-a', messageId: 'does-not-exist' })
    expect(getPendingCount('pane-a')).toBe(1)
  })
})

describe('bridgeStore — bridgePendingClear', () => {
  it('empties the list for the specified pane', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore
      .getState()
      .bridgePendingReceived({ ...MSG_A, messageId: 'msg-1b', createdAt: 1500 })
    useBridgeStore.getState().bridgePendingClear('pane-a')
    expect(getPendingCount('pane-a')).toBe(0)
    expect(getPendingMessages('pane-a')).toHaveLength(0)
  })

  it('is a no-op for an unknown pane', () => {
    useBridgeStore.getState().bridgePendingClear('nonexistent-pane')
    expect(getPendingCount('nonexistent-pane')).toBe(0)
  })
})

describe('bridgeStore — dedup by messageId', () => {
  it('adding the same messageId twice is a no-op the second time', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    // Second call with identical messageId — should be silently ignored.
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    expect(getPendingCount('pane-a')).toBe(1)
    expect(getPendingMessages('pane-a')).toHaveLength(1)
  })

  it('distinct messageIds on the same pane both accumulate', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore.getState().bridgePendingReceived({ ...MSG_A, messageId: 'msg-1b' })
    expect(getPendingCount('pane-a')).toBe(2)
  })
})

describe('bridgeStore — selectors', () => {
  it('getPendingCount returns 0 for an unknown pane', () => {
    expect(getPendingCount('no-such-pane')).toBe(0)
  })

  it('getPendingMessages returns empty array for unknown pane', () => {
    expect(getPendingMessages('no-such-pane')).toEqual([])
  })

  it('getPendingMessages returns messages in insertion order', () => {
    useBridgeStore.getState().bridgePendingReceived(MSG_A)
    useBridgeStore
      .getState()
      .bridgePendingReceived({ ...MSG_A, messageId: 'msg-1b', createdAt: 1500 })
    const msgs = getPendingMessages('pane-a')
    expect(msgs[0].messageId).toBe('msg-1')
    expect(msgs[1].messageId).toBe('msg-1b')
  })
})
