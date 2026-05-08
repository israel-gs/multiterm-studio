/** @vitest-environment node */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openDb, runMigrations } from '../../../src/main/bridge/db'
import { ERROR_CODES } from '../../../src/main/bridge/protocol'
import {
  touchAgent,
  setAlias,
  resolveTarget,
  deregisterAgent,
  listActiveAgents
} from '../../../src/main/bridge/registry'

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
  runMigrations(db)
})

afterEach(() => {
  try {
    db.close()
  } catch {
    /* ignore */
  }
})

// ── touchAgent — auto-register on first touch ────────────────────────────────

describe('touchAgent', () => {
  test('creates a new agent record on first call', () => {
    touchAgent(db, 'pane-abc')
    const row = db.prepare('SELECT * FROM agents WHERE pane_id = ?').get('pane-abc') as
      | { pane_id: string; alias: string | null; active: number }
      | undefined
    expect(row).toBeDefined()
    expect(row!.pane_id).toBe('pane-abc')
    expect(row!.alias).toBeNull()
    expect(row!.active).toBe(1)
  })

  test('sets both created_at and last_seen_at on first call', () => {
    const before = Date.now()
    touchAgent(db, 'pane-abc')
    const after = Date.now()
    const row = db
      .prepare('SELECT created_at, last_seen_at FROM agents WHERE pane_id = ?')
      .get('pane-abc') as { created_at: number; last_seen_at: number } | undefined
    expect(row!.created_at).toBeGreaterThanOrEqual(before)
    expect(row!.created_at).toBeLessThanOrEqual(after)
    expect(row!.last_seen_at).toBeGreaterThanOrEqual(before)
  })

  test('updates last_seen_at on subsequent calls without changing created_at', async () => {
    touchAgent(db, 'pane-abc')
    const first = db
      .prepare('SELECT created_at, last_seen_at FROM agents WHERE pane_id = ?')
      .get('pane-abc') as { created_at: number; last_seen_at: number }

    // Small delay to ensure the timestamp advances.
    await new Promise((r) => setTimeout(r, 5))
    touchAgent(db, 'pane-abc')

    const second = db
      .prepare('SELECT created_at, last_seen_at FROM agents WHERE pane_id = ?')
      .get('pane-abc') as { created_at: number; last_seen_at: number }

    expect(second.created_at).toBe(first.created_at)
    expect(second.last_seen_at).toBeGreaterThanOrEqual(first.last_seen_at)
  })

  test('touching an inactive pane reactivates it', () => {
    touchAgent(db, 'pane-abc')
    deregisterAgent(db, 'pane-abc')

    const inactive = db.prepare('SELECT active FROM agents WHERE pane_id = ?').get('pane-abc') as {
      active: number
    }
    expect(inactive.active).toBe(0)

    touchAgent(db, 'pane-abc')
    const reactivated = db
      .prepare('SELECT active FROM agents WHERE pane_id = ?')
      .get('pane-abc') as { active: number }
    expect(reactivated.active).toBe(1)
  })
})

// ── setAlias ──────────────────────────────────────────────────────────────────

describe('setAlias', () => {
  beforeEach(() => {
    touchAgent(db, 'pane-abc')
    touchAgent(db, 'pane-xyz')
  })

  test('assigns an alias to a pane', () => {
    setAlias(db, 'pane-abc', 'reviewer')
    const row = db.prepare('SELECT alias FROM agents WHERE pane_id = ?').get('pane-abc') as {
      alias: string
    }
    expect(row.alias).toBe('reviewer')
  })

  test('returns success-like result on assignment', () => {
    const result = setAlias(db, 'pane-abc', 'reviewer')
    expect(result).toEqual({ ok: true })
  })

  test('allows alphanumeric, underscore, and hyphen characters', () => {
    expect(() => setAlias(db, 'pane-abc', 'my_alias-1')).not.toThrow()
  })

  test('collision returns error code -32021 (AliasCollision)', () => {
    setAlias(db, 'pane-abc', 'reviewer')
    const result = setAlias(db, 'pane-xyz', 'reviewer')
    expect(result).toEqual({
      error: { code: ERROR_CODES.AliasCollision, message: expect.any(String) }
    })
  })

  test('pane can set its own alias again (idempotent re-assignment)', () => {
    setAlias(db, 'pane-abc', 'reviewer')
    const result = setAlias(db, 'pane-abc', 'reviewer')
    expect(result).toEqual({ ok: true })
  })

  test('clear alias (null) releases it', () => {
    setAlias(db, 'pane-abc', 'reviewer')
    setAlias(db, 'pane-abc', null)

    // Now pane-xyz can claim 'reviewer'
    const result = setAlias(db, 'pane-xyz', 'reviewer')
    expect(result).toEqual({ ok: true })
  })

  test('invalid alias format (space) returns -32602', () => {
    const result = setAlias(db, 'pane-abc', 'has space')
    expect(result).toEqual({ error: { code: -32602, message: expect.any(String) } })
  })

  test('invalid alias format (leading @) returns -32602', () => {
    const result = setAlias(db, 'pane-abc', '@reviewer')
    expect(result).toEqual({ error: { code: -32602, message: expect.any(String) } })
  })

  test('empty alias string returns -32602', () => {
    const result = setAlias(db, 'pane-abc', '')
    expect(result).toEqual({ error: { code: -32602, message: expect.any(String) } })
  })
})

// ── resolveTarget ─────────────────────────────────────────────────────────────

describe('resolveTarget', () => {
  beforeEach(() => {
    touchAgent(db, 'pane-abc')
    setAlias(db, 'pane-abc', 'reviewer')
    touchAgent(db, 'pane-xyz')
  })

  test('resolves by raw pane id', () => {
    const result = resolveTarget(db, 'pane-abc')
    expect(result).toEqual({ paneId: 'pane-abc' })
  })

  test('resolves by @alias', () => {
    const result = resolveTarget(db, '@reviewer')
    expect(result).toEqual({ paneId: 'pane-abc' })
  })

  test('resolve by id for pane without alias', () => {
    const result = resolveTarget(db, 'pane-xyz')
    expect(result).toEqual({ paneId: 'pane-xyz' })
  })

  test('missing @alias returns -32020 (PaneNotFound)', () => {
    const result = resolveTarget(db, '@ghost')
    expect(result).toEqual({
      error: { code: ERROR_CODES.PaneNotFound, message: expect.any(String) }
    })
  })

  test('missing pane id returns -32020 (PaneNotFound)', () => {
    const result = resolveTarget(db, 'pane-missing')
    expect(result).toEqual({
      error: { code: ERROR_CODES.PaneNotFound, message: expect.any(String) }
    })
  })

  test('inactive pane is not resolved by id', () => {
    deregisterAgent(db, 'pane-xyz')
    const result = resolveTarget(db, 'pane-xyz')
    expect(result).toEqual({
      error: { code: ERROR_CODES.PaneNotFound, message: expect.any(String) }
    })
  })

  test('inactive pane alias is not resolved', () => {
    deregisterAgent(db, 'pane-abc')
    const result = resolveTarget(db, '@reviewer')
    expect(result).toEqual({
      error: { code: ERROR_CODES.PaneNotFound, message: expect.any(String) }
    })
  })
})

// ── deregisterAgent ───────────────────────────────────────────────────────────

describe('deregisterAgent', () => {
  beforeEach(() => {
    touchAgent(db, 'pane-abc')
    setAlias(db, 'pane-abc', 'reviewer')
    touchAgent(db, 'pane-xyz')
  })

  test('marks pane as inactive', () => {
    deregisterAgent(db, 'pane-abc')
    const row = db.prepare('SELECT active FROM agents WHERE pane_id = ?').get('pane-abc') as {
      active: number
    }
    expect(row.active).toBe(0)
  })

  test('releases the alias so another pane can claim it', () => {
    deregisterAgent(db, 'pane-abc')
    const result = setAlias(db, 'pane-xyz', 'reviewer')
    expect(result).toEqual({ ok: true })
  })

  test('deregistering a non-existent pane does not throw', () => {
    expect(() => deregisterAgent(db, 'pane-nonexistent')).not.toThrow()
  })
})

// ── listActiveAgents ──────────────────────────────────────────────────────────

describe('listActiveAgents', () => {
  test('returns empty array when no agents registered', () => {
    expect(listActiveAgents(db)).toEqual([])
  })

  test('returns only active panes', () => {
    touchAgent(db, 'pane-1')
    touchAgent(db, 'pane-2')
    touchAgent(db, 'pane-3')
    deregisterAgent(db, 'pane-2')

    const result = listActiveAgents(db)
    const ids = result.map((r) => r.paneId)
    expect(ids).toContain('pane-1')
    expect(ids).toContain('pane-3')
    expect(ids).not.toContain('pane-2')
  })

  test('each record includes paneId, alias, createdAt, lastSeenAt', () => {
    touchAgent(db, 'pane-1')
    setAlias(db, 'pane-1', 'worker')
    const [agent] = listActiveAgents(db)
    expect(agent).toMatchObject({
      paneId: 'pane-1',
      alias: 'worker',
      createdAt: expect.any(Number),
      lastSeenAt: expect.any(Number)
    })
  })

  test('pane without alias has alias: null', () => {
    touchAgent(db, 'pane-1')
    const [agent] = listActiveAgents(db)
    expect(agent.alias).toBeNull()
  })

  test('ordered by lastSeenAt descending', async () => {
    touchAgent(db, 'pane-1')
    await new Promise((r) => setTimeout(r, 5))
    touchAgent(db, 'pane-2')
    await new Promise((r) => setTimeout(r, 5))
    touchAgent(db, 'pane-3')

    const result = listActiveAgents(db)
    const ids = result.map((r) => r.paneId)
    expect(ids[0]).toBe('pane-3')
    expect(ids[1]).toBe('pane-2')
    expect(ids[2]).toBe('pane-1')
  })

  test('count matches active agents', () => {
    touchAgent(db, 'pane-1')
    touchAgent(db, 'pane-2')
    touchAgent(db, 'pane-3')
    deregisterAgent(db, 'pane-1')

    expect(listActiveAgents(db)).toHaveLength(2)
  })
})
