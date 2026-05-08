import { randomUUID } from 'crypto'
import type { Database } from 'better-sqlite3'
import { ERROR_CODES } from './protocol'
import { resolveTarget } from './registry'
import { BridgeError } from './tasks'

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Abstraction for publishing IPC events to the renderer.
 * Production implementation uses BrowserWindow.getAllWindows()[0]?.webContents.send().
 * Tests inject a fake.
 */
export interface EventPublisher {
  publish(channel: string, payload: unknown): void
}

export interface MessageRecord {
  id: string
  fromPane: string
  toPane: string
  body: string
  kind: 'send' | 'notify'
  status: string
  createdAt: number
  resolvedAt: number | null
}

type DbMsgRow = {
  id: string
  from_pane: string
  to_pane: string
  body: string
  kind: 'send' | 'notify'
  status: string
  created_at: number
  resolved_at: number | null
}

// ── Send-to params ────────────────────────────────────────────────────────────

export interface SendToParams {
  from: string
  to: string
  body: string
  timeoutMs?: number
}

export interface NotifyParams {
  from: string
  to: string
  body: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MIN = 1000
const TIMEOUT_MAX = 3_600_000
const TIMEOUT_DEFAULT = 60_000
const NOTIFY_AUTO_DISMISS_MS = 30_000

// ── In-memory pending promise registry ───────────────────────────────────────

// Maps msgId → { resolve, reject, timer } for in-flight send-to calls.
// This is intentionally NOT persisted: on server shutdown, all pending promises
// are rejected with BridgeShutdown by the BridgeServer.
type PendingEntry = {
  resolve: (value: { ok: true; response: string | null }) => void
  reject: (err: BridgeError) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingMap = new Map<string, PendingEntry>()

/**
 * Rejects all in-flight send-to calls with BridgeShutdown.
 * Called by BridgeServer.close() before the socket is torn down.
 */
export function rejectAllPending(): void {
  for (const [, entry] of pendingMap) {
    clearTimeout(entry.timer)
    entry.reject(new BridgeError(ERROR_CODES.BridgeShutdown, 'Bridge server is shutting down.'))
  }
  pendingMap.clear()
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Registers a send-to request. Inserts a pending message in the DB, publishes
 * a `bridge:pending` IPC event to the renderer, and returns a Promise that:
 * - resolves with `{ ok: true }` when the user accepts.
 * - rejects with -32040 (DeclinedByUser) when the user declines.
 * - rejects with -32041 (Timeout) after the effective timeout elapses.
 * - rejects with -32020 (PaneNotFound) immediately if target is unknown.
 *
 * `clock` is injected for testability (vi.fn() in tests, setTimeout in prod).
 */
export function sendTo(
  db: Database,
  publisher: EventPublisher,
  // clock is kept for interface parity but we rely on native setTimeout so that
  // vi.useFakeTimers() intercepts calls transparently.
  _clock: unknown,
  params: SendToParams
): Promise<{ ok: true; response: string | null }> {
  const { from, to, body } = params
  const rawTimeout = params.timeoutMs ?? TIMEOUT_DEFAULT
  const effectiveTimeout = Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, rawTimeout))

  // Resolve target pane first — fail fast before touching DB.
  const resolved = resolveTarget(db, to)
  if ('error' in resolved) {
    return Promise.reject(new BridgeError(resolved.error.code, resolved.error.message))
  }

  const toPane = resolved.paneId
  const msgId = randomUUID()
  const now = Date.now()

  // Persist the pending message. The record must survive app restart.
  db.prepare(
    `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
     VALUES (?, ?, ?, ?, 'send', 'pending', ?)`
  ).run(msgId, from, toPane, body, now)

  publisher.publish('bridge:pending', { msgId, fromPane: from, toPane, body, kind: 'send' })

  return new Promise<{ ok: true; response: string | null }>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendingMap.has(msgId)) return
      pendingMap.delete(msgId)

      // Mark timed-out in DB
      db.prepare(`UPDATE messages SET status = 'timed_out', resolved_at = ? WHERE id = ?`).run(
        Date.now(),
        msgId
      )

      // Dismiss the chip from the renderer
      publisher.publish('bridge:dismiss', { msgId, toPane })

      reject(
        new BridgeError(
          ERROR_CODES.Timeout,
          `Message "${msgId}" timed out after ${effectiveTimeout} ms.`
        )
      )
    }, effectiveTimeout)

    pendingMap.set(msgId, { resolve, reject, timer })
  })
}

/**
 * Resolves a pending send-to promise with success. Also updates the message
 * status in the DB and notifies the renderer.
 *
 * The optional `response` text comes from the user typing a reply in the modal
 * before clicking Accept. When absent, `response_text` is stored as NULL and
 * the promise resolves with `{ response: null }`.
 */
export function acceptMessage(
  db: Database,
  publisher: EventPublisher,
  msgId: string,
  response?: string
): void {
  const responseText = response ?? null

  // Always update the DB so the message no longer surfaces in `pending` queries
  // (rehydration after a renderer reload depends on this). The in-memory pending
  // entry may be absent if the original caller already left or if the renderer
  // is acting on a message restored from a prior session.
  db.prepare(
    `UPDATE messages SET status = 'accepted', resolved_at = ?, response_text = ? WHERE id = ?`
  ).run(Date.now(), responseText, msgId)

  publisher.publish('bridge:accepted', { msgId })

  // Resolve the live promise only if the original caller is still waiting.
  const entry = pendingMap.get(msgId)
  if (entry) {
    clearTimeout(entry.timer)
    pendingMap.delete(msgId)
    entry.resolve({ ok: true, response: responseText })
  }
}

/**
 * Rejects a pending send-to promise with DeclinedByUser. Updates DB.
 */
export function declineMessage(db: Database, publisher: EventPublisher, msgId: string): void {
  // Always update DB regardless of in-memory entry presence (same rationale as
  // acceptMessage — handles rehydration of orphan messages).
  db.prepare(`UPDATE messages SET status = 'declined', resolved_at = ? WHERE id = ?`).run(
    Date.now(),
    msgId
  )

  publisher.publish('bridge:declined', { msgId })

  const entry = pendingMap.get(msgId)
  if (entry) {
    clearTimeout(entry.timer)
    pendingMap.delete(msgId)
    entry.reject(
      new BridgeError(ERROR_CODES.DeclinedByUser, `Message "${msgId}" was declined by the user.`)
    )
  }
}

/**
 * Fires a fire-and-forget notification. Returns immediately with an ack object.
 * The message is marked `pending` in the DB. An auto-dismiss timer runs after
 * 30 seconds to transition it to `auto_accepted` and publish `bridge:dismiss`.
 *
 * Throws -32020 synchronously if the target pane is not found.
 */
export function notify(
  db: Database,
  publisher: EventPublisher,
  _clock: unknown,
  params: NotifyParams
): { ok: true; msgId: string } {
  const { from, to, body } = params

  const resolved = resolveTarget(db, to)
  if ('error' in resolved) {
    throw new BridgeError(resolved.error.code, resolved.error.message)
  }

  const toPane = resolved.paneId
  const msgId = randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
     VALUES (?, ?, ?, ?, 'notify', 'pending', ?)`
  ).run(msgId, from, toPane, body, now)

  publisher.publish('bridge:pending', { msgId, fromPane: from, toPane, body, kind: 'notify' })

  // Auto-dismiss notify chips after 30 seconds without user interaction.
  setTimeout(() => {
    db.prepare(
      `UPDATE messages SET status = 'auto_accepted', resolved_at = ? WHERE id = ? AND status = 'pending'`
    ).run(Date.now(), msgId)
    publisher.publish('bridge:dismiss', { msgId, toPane })
  }, NOTIFY_AUTO_DISMISS_MS)

  return { ok: true, msgId }
}

/**
 * Queries the message log. Used by the renderer to repopulate chip counts
 * after restart, and by tests to verify persistence.
 */
export function listMessages(
  db: Database,
  filters: { toPane?: string; status?: string }
): MessageRecord[] {
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (filters.toPane !== undefined) {
    conditions.push('to_pane = ?')
    bindings.push(filters.toPane)
  }

  if (filters.status !== undefined) {
    conditions.push('status = ?')
    bindings.push(filters.status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM messages ${where} ORDER BY created_at ASC`)
    .all(...bindings) as DbMsgRow[]

  return rows.map((r) => ({
    id: r.id,
    fromPane: r.from_pane,
    toPane: r.to_pane,
    body: r.body,
    kind: r.kind,
    status: r.status,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at
  }))
}

// ── Production publisher ──────────────────────────────────────────────────────

/**
 * Creates the production EventPublisher that forwards events to the renderer
 * via Electron's IPC. Import BrowserWindow lazily to avoid Electron-module
 * errors in tests (which run under plain Node).
 */
export function makeElectronPublisher(): EventPublisher {
  return {
    publish(channel: string, payload: unknown): void {
      // Dynamic require avoids pulling electron into test environments.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BrowserWindow } = require('electron') as typeof import('electron')
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  }
}
