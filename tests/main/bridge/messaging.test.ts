/** @vitest-environment node */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openDb, runMigrations } from '../../../src/main/bridge/db'
import { ERROR_CODES } from '../../../src/main/bridge/protocol'
import { touchAgent, setAlias } from '../../../src/main/bridge/registry'
import type { EventPublisher } from '../../../src/main/bridge/messaging'
import {
  sendTo,
  notify,
  acceptMessage,
  declineMessage,
  listMessages
} from '../../../src/main/bridge/messaging'

// ── Fake publisher ─────────────────────────────────────────────────────────────

function makeFakePublisher(): EventPublisher & {
  calls: Array<{ channel: string; payload: unknown }>
} {
  const calls: Array<{ channel: string; payload: unknown }> = []
  return {
    calls,
    publish(channel: string, payload: unknown): void {
      calls.push({ channel, payload })
    }
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: Database
let publisher: ReturnType<typeof makeFakePublisher>

beforeEach(() => {
  vi.useFakeTimers()
  db = openDb(':memory:')
  runMigrations(db)
  touchAgent(db, 'pane-a')
  touchAgent(db, 'pane-b')
  setAlias(db, 'pane-b', 'b')
  publisher = makeFakePublisher()
})

afterEach(() => {
  vi.useRealTimers()
  try {
    db.close()
  } catch {
    /* ignore */
  }
})

// ── sendTo ────────────────────────────────────────────────────────────────────

describe('sendTo — accept flow', () => {
  test('resolves with success when acceptMessage is called', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: '@b',
      body: 'hello',
      timeoutMs: 5000
    })

    // Locate the inserted message id via published event
    const evt = publisher.calls[0]
    expect(evt.channel).toBe('bridge:pending')
    const msgId = (evt.payload as { msgId: string }).msgId

    acceptMessage(db, publisher, msgId, 'ack response')
    const result = await p
    expect(result).toMatchObject({ ok: true })
  })

  test('persists message with status=pending after sendTo call', () => {
    sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'ping',
      timeoutMs: 5000
    })

    const evt = publisher.calls[0]
    const msgId = (evt.payload as { msgId: string }).msgId

    const rows = listMessages(db, { toPane: 'pane-b', status: 'pending' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(msgId)
    expect(rows[0].kind).toBe('send')
  })

  test('publishes bridge:pending event with correct fields', () => {
    sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'test',
      timeoutMs: 5000
    })
    const evt = publisher.calls[0]
    expect(evt.channel).toBe('bridge:pending')
    expect(evt.payload).toMatchObject({
      msgId: expect.any(String),
      fromPane: 'pane-a',
      toPane: 'pane-b',
      kind: 'send'
    })
  })
})

describe('sendTo — decline flow', () => {
  test('rejects with -32040 when declineMessage is called', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: '@b',
      body: 'declined',
      timeoutMs: 5000
    })

    const evt = publisher.calls[0]
    const msgId = (evt.payload as { msgId: string }).msgId

    declineMessage(db, publisher, msgId)
    await expect(p).rejects.toMatchObject({ code: ERROR_CODES.DeclinedByUser })
  })

  test('persists message with status=declined after decline', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'bye',
      timeoutMs: 5000
    })

    const evt = publisher.calls[0]
    const msgId = (evt.payload as { msgId: string }).msgId

    declineMessage(db, publisher, msgId)
    await expect(p).rejects.toBeDefined()

    const rows = listMessages(db, { toPane: 'pane-b', status: 'declined' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(msgId)
  })
})

describe('sendTo — timeout flow', () => {
  test('rejects with -32041 after timeoutMs elapses', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'slow',
      timeoutMs: 60000
    })

    vi.advanceTimersByTime(60000)
    await expect(p).rejects.toMatchObject({ code: ERROR_CODES.Timeout })
  })

  test('defaults to 60000 ms when timeoutMs is not provided', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'no timeout param'
    })

    // 59999 ms passes — should NOT have timed out yet
    vi.advanceTimersByTime(59999)
    // Flush microtasks without advancing time further
    let settled = false
    p.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    vi.advanceTimersByTime(1)
    await expect(p).rejects.toMatchObject({ code: ERROR_CODES.Timeout })
  })

  test('clamps timeoutMs below 1000 to 1000', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'too-small',
      timeoutMs: 100
    })

    // 999 ms — should still be pending
    vi.advanceTimersByTime(999)
    let settled = false
    p.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    vi.advanceTimersByTime(1)
    await expect(p).rejects.toMatchObject({ code: ERROR_CODES.Timeout })
  })

  test('clamps timeoutMs above 3600000 to 3600000', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'too-large',
      timeoutMs: 86400000
    })

    // Exactly at clamped maximum
    vi.advanceTimersByTime(3600000)
    await expect(p).rejects.toMatchObject({ code: ERROR_CODES.Timeout })
  })

  test('timeout publishes bridge:dismiss event for the chip', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'dismiss-me',
      timeoutMs: 5000
    })

    const msgId = (publisher.calls[0].payload as { msgId: string }).msgId
    vi.advanceTimersByTime(5000)
    await expect(p).rejects.toBeDefined()

    const dismissEvt = publisher.calls.find((c) => c.channel === 'bridge:dismiss')
    expect(dismissEvt).toBeDefined()
    expect((dismissEvt!.payload as { msgId: string }).msgId).toBe(msgId)
  })
})

describe('sendTo — target not found', () => {
  test('rejects immediately with -32020 for unknown target', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: '@ghost',
      body: 'nobody home'
    })
    await expect(p).rejects.toMatchObject({ code: ERROR_CODES.PaneNotFound })
  })
})

// ── notify ────────────────────────────────────────────────────────────────────

describe('notify', () => {
  test('returns ack immediately (synchronous)', () => {
    const result = notify(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'build done'
    })
    expect(result).toMatchObject({ ok: true, msgId: expect.any(String) })
  })

  test('publishes bridge:pending event', () => {
    notify(db, publisher, vi.fn(), { from: 'pane-a', to: 'pane-b', body: 'info' })
    expect(publisher.calls[0].channel).toBe('bridge:pending')
    expect((publisher.calls[0].payload as { kind: string }).kind).toBe('notify')
  })

  test('inserts message with kind=notify and status=pending', () => {
    const result = notify(db, publisher, vi.fn(), { from: 'pane-a', to: 'pane-b', body: 'x' })
    const rows = listMessages(db, { toPane: 'pane-b', status: 'pending' })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(result.msgId)
    expect(rows[0].kind).toBe('notify')
  })

  test('returns -32020 for missing target', () => {
    expect(() =>
      notify(db, publisher, vi.fn(), { from: 'pane-a', to: '@nobody', body: 'x' })
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.PaneNotFound }))
  })

  test('auto-dismisses after 30 seconds', async () => {
    const result = notify(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'ephemeral'
    })

    vi.advanceTimersByTime(30000)
    // Message should now be auto-accepted/dismissed
    await Promise.resolve()

    const rows = listMessages(db, { toPane: 'pane-b', status: 'auto_accepted' })
    expect(rows.some((r) => r.id === result.msgId)).toBe(true)
  })

  test('auto-dismiss publishes bridge:dismiss', async () => {
    const result = notify(db, publisher, vi.fn(), { from: 'pane-a', to: 'pane-b', body: 'gone' })

    vi.advanceTimersByTime(30000)
    await Promise.resolve()

    const dismissEvt = publisher.calls.find((c) => c.channel === 'bridge:dismiss')
    expect(dismissEvt).toBeDefined()
    expect((dismissEvt!.payload as { msgId: string }).msgId).toBe(result.msgId)
  })
})

// ── acceptMessage — response text ────────────────────────────────────────────

describe('acceptMessage — response text', () => {
  test('resolves with { response: "got it" } when response text is passed', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'please reply',
      timeoutMs: 5000
    })

    const msgId = (publisher.calls[0].payload as { msgId: string }).msgId
    acceptMessage(db, publisher, msgId, 'got it')
    const result = await p
    expect(result).toMatchObject({ ok: true, response: 'got it' })
  })

  test('resolves with { response: null } when no response argument is passed', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'silent accept',
      timeoutMs: 5000
    })

    const msgId = (publisher.calls[0].payload as { msgId: string }).msgId
    acceptMessage(db, publisher, msgId)
    const result = await p
    expect(result).toMatchObject({ ok: true, response: null })
  })

  test('persists response_text in the messages table', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'with text',
      timeoutMs: 5000
    })

    const msgId = (publisher.calls[0].payload as { msgId: string }).msgId
    acceptMessage(db, publisher, msgId, 'acknowledged')
    await p

    const row = db.prepare('SELECT response_text FROM messages WHERE id = ?').get(msgId) as {
      response_text: string | null
    }
    expect(row.response_text).toBe('acknowledged')
  })
})

// ── acceptMessage / declineMessage — DB-only path (no live pendingMap entry) ──

describe('acceptMessage — DB update without live pendingMap entry', () => {
  test('updates status to accepted and sets resolved_at even when pendingMap has no entry', () => {
    // Insert a pending message directly, bypassing sendTo so pendingMap stays empty.
    const msgId = 'orphan-accept-1'
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES (?, 'pane-a', 'pane-b', 'orphan body', 'send', 'pending', ?)`
    ).run(msgId, Date.now())

    // Should not throw even though pendingMap has no entry for this id.
    expect(() => acceptMessage(db, publisher, msgId, 'response text')).not.toThrow()

    const row = db
      .prepare('SELECT status, response_text, resolved_at FROM messages WHERE id = ?')
      .get(msgId) as { status: string; response_text: string | null; resolved_at: number | null }

    expect(row.status).toBe('accepted')
    expect(row.response_text).toBe('response text')
    expect(row.resolved_at).toBeTruthy()
  })

  test('publishes bridge:accepted event with the msgId', () => {
    const msgId = 'orphan-accept-2'
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES (?, 'pane-a', 'pane-b', 'body', 'send', 'pending', ?)`
    ).run(msgId, Date.now())

    acceptMessage(db, publisher, msgId, 'ack')

    const evt = publisher.calls.find((c) => c.channel === 'bridge:accepted')
    expect(evt).toBeDefined()
    expect((evt!.payload as { msgId: string }).msgId).toBe(msgId)
  })
})

describe('declineMessage — DB update without live pendingMap entry', () => {
  test('updates status to declined and sets resolved_at even when pendingMap has no entry', () => {
    const msgId = 'orphan-decline-1'
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES (?, 'pane-a', 'pane-b', 'orphan body', 'send', 'pending', ?)`
    ).run(msgId, Date.now())

    expect(() => declineMessage(db, publisher, msgId)).not.toThrow()

    const row = db.prepare('SELECT status, resolved_at FROM messages WHERE id = ?').get(msgId) as {
      status: string
      resolved_at: number | null
    }

    expect(row.status).toBe('declined')
    expect(row.resolved_at).toBeTruthy()
  })

  test('publishes bridge:declined event with the msgId', () => {
    const msgId = 'orphan-decline-2'
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES (?, 'pane-a', 'pane-b', 'body', 'send', 'pending', ?)`
    ).run(msgId, Date.now())

    declineMessage(db, publisher, msgId)

    const evt = publisher.calls.find((c) => c.channel === 'bridge:declined')
    expect(evt).toBeDefined()
    expect((evt!.payload as { msgId: string }).msgId).toBe(msgId)
  })
})

// ── listMessages — status filter (rehydration backbone) ───────────────────────

describe('listMessages — status filter', () => {
  test('returns only messages matching the requested status', () => {
    // Insert one message per status directly — no sendTo, so no pendingMap side effects.
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES ('lm-pending', 'pane-a', 'pane-b', 'p', 'send', 'pending', 1)`
    ).run()
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at, resolved_at)
       VALUES ('lm-accepted', 'pane-a', 'pane-b', 'a', 'send', 'accepted', 2, 3)`
    ).run()
    db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at, resolved_at)
       VALUES ('lm-declined', 'pane-a', 'pane-b', 'd', 'send', 'declined', 4, 5)`
    ).run()

    const pending = listMessages(db, { status: 'pending' })
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe('lm-pending')

    const accepted = listMessages(db, { status: 'accepted' })
    expect(accepted).toHaveLength(1)
    expect(accepted[0].id).toBe('lm-accepted')
  })
})

// ── Message log persistence ───────────────────────────────────────────────────

describe('message log persistence', () => {
  test('pending message survives DB reopen', () => {
    const tmpPath = `/tmp/multiterm-msg-test-${Date.now()}.db`
    const db1 = openDb(tmpPath)
    runMigrations(db1)
    touchAgent(db1, 'pane-a')
    touchAgent(db1, 'pane-b')
    const pub = makeFakePublisher()

    // Intentionally do NOT resolve — leave pending
    sendTo(db1, pub, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'pending forever',
      timeoutMs: 999999
    })
    db1.close()

    const db2 = openDb(tmpPath)
    runMigrations(db2)
    const rows = listMessages(db2, { toPane: 'pane-b', status: 'pending' })
    db2.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('send')
  })

  test('accepted message has resolved_at set', async () => {
    const p = sendTo(db, publisher, vi.fn(), {
      from: 'pane-a',
      to: 'pane-b',
      body: 'resolve me',
      timeoutMs: 5000
    })

    const msgId = (publisher.calls[0].payload as { msgId: string }).msgId
    acceptMessage(db, publisher, msgId)
    await p

    const rows = listMessages(db, { toPane: 'pane-b', status: 'accepted' })
    expect(rows).toHaveLength(1)
    expect(rows[0].resolvedAt).toBeTruthy()
  })
})
