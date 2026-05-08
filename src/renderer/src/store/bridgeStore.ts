import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingMessage {
  messageId: string
  fromPane: string
  fromAlias: string | null
  body: string
  kind: 'send' | 'notify'
  createdAt: number
}

interface BridgeStore {
  pendingByPane: Record<string, PendingMessage[]>
  bridgePendingReceived(p: { paneId: string } & PendingMessage): void
  bridgeMessageResolved(p: { paneId: string; messageId: string }): void
  bridgePendingClear(paneId: string): void
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useBridgeStore = create<BridgeStore>((set) => ({
  pendingByPane: {},

  bridgePendingReceived({ paneId, messageId, fromPane, fromAlias, body, kind, createdAt }) {
    set((s) => {
      const existing = s.pendingByPane[paneId] ?? []
      // Dedupe by messageId — protects against races between live IPC events
      // and rehydration via bridgeListPending on renderer mount.
      if (existing.some((m) => m.messageId === messageId)) {
        return s
      }
      return {
        pendingByPane: {
          ...s.pendingByPane,
          [paneId]: [...existing, { messageId, fromPane, fromAlias, body, kind, createdAt }]
        }
      }
    })
  },

  bridgeMessageResolved({ paneId, messageId }) {
    set((s) => {
      const existing = s.pendingByPane[paneId]
      if (!existing) return s
      return {
        pendingByPane: {
          ...s.pendingByPane,
          [paneId]: existing.filter((m) => m.messageId !== messageId)
        }
      }
    })
  },

  bridgePendingClear(paneId) {
    set((s) => ({
      pendingByPane: {
        ...s.pendingByPane,
        [paneId]: []
      }
    }))
  }
}))

// ── Selectors ─────────────────────────────────────────────────────────────────

/** Returns the number of pending messages for a pane. */
export function getPendingCount(paneId: string): number {
  return useBridgeStore.getState().pendingByPane[paneId]?.length ?? 0
}

/** Returns all pending messages for a pane, in insertion order. */
export function getPendingMessages(paneId: string): PendingMessage[] {
  return useBridgeStore.getState().pendingByPane[paneId] ?? []
}
