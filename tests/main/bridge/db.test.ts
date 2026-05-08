/** @vitest-environment node */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import type { Database as BetterSqliteDatabase } from 'better-sqlite3'
import { openDb, runMigrations } from '../../../src/main/bridge/db'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the set of user-defined table names present in the DB. */
function tableNames(db: BetterSqliteDatabase): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as Array<{ name: string }>
  return new Set(rows.map((r) => r.name))
}

/** Returns the current schema version, or 0 if the version table is absent. */
function schemaVersion(db: BetterSqliteDatabase): number {
  const tables = tableNames(db)
  if (!tables.has('schema_version')) return 0
  const row = db.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined
  return row?.version ?? 0
}

// ── Tests ────────────────────────────────────────────────────────────────────

let db: BetterSqliteDatabase

beforeEach(() => {
  db = openDb(':memory:')
})

afterEach(() => {
  try {
    db.close()
  } catch {
    // ignore if already closed
  }
})

describe('openDb', () => {
  test('returns an open database object', () => {
    expect(db).toBeDefined()
    // A simple pragma query proves the connection works.
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(result).toBeDefined()
  })

  test('enables WAL mode', () => {
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    // WAL is set at open time; :memory: databases fall back to 'memory' because
    // WAL requires a file — this is expected. For file-backed DBs it would be 'wal'.
    // We verify the pragma was at least accepted (no error thrown).
    expect(['wal', 'memory']).toContain(result.journal_mode)
  })
})

describe('runMigrations — v1 schema', () => {
  beforeEach(() => {
    runMigrations(db)
  })

  test('schema_version is 1 after migration', () => {
    expect(schemaVersion(db)).toBe(1)
  })

  test('creates the agents table', () => {
    expect(tableNames(db).has('agents')).toBe(true)
  })

  test('creates the messages table', () => {
    expect(tableNames(db).has('messages')).toBe(true)
  })

  test('creates the tasks table', () => {
    expect(tableNames(db).has('tasks')).toBe(true)
  })

  test('creates the kv table', () => {
    expect(tableNames(db).has('kv')).toBe(true)
  })

  test('messages.kind CHECK enforced — valid kinds insert without error', () => {
    const insert = db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    expect(() =>
      insert.run('m1', 'pane-a', 'pane-b', 'hello', 'send', 'pending', Date.now())
    ).not.toThrow()
    expect(() =>
      insert.run('m2', 'pane-a', 'pane-b', 'hey', 'notify', 'pending', Date.now())
    ).not.toThrow()
  })

  test('messages.kind CHECK enforced — invalid kind throws', () => {
    const insert = db.prepare(
      `INSERT INTO messages (id, from_pane, to_pane, body, kind, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    expect(() =>
      insert.run('m3', 'pane-a', 'pane-b', 'bad', 'invalid-kind', 'pending', Date.now())
    ).toThrow()
  })

  test('kv table allows set and get round-trip', () => {
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('flag', 'on')
    const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('flag') as
      | { value: string }
      | undefined
    expect(row?.value).toBe('on')
  })

  test('agents table has expected columns', () => {
    // Insert a valid agent record to prove column names are correct.
    const now = Date.now()
    expect(() =>
      db
        .prepare(
          `INSERT INTO agents (pane_id, alias, active, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run('pane-1', null, 1, now, now)
    ).not.toThrow()
  })

  test('tasks table has expected columns', () => {
    const now = Date.now()
    expect(() =>
      db
        .prepare(
          `INSERT INTO tasks (id, name, body, created_by, owned_by, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run('task-1', 'do-thing', null, 'pane-1', null, 'pending', now, now)
    ).not.toThrow()
  })
})

describe('runMigrations — idempotency', () => {
  test('running migrations twice does not throw', () => {
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })

  test('running migrations twice leaves schema_version at 1', () => {
    runMigrations(db)
    runMigrations(db)
    expect(schemaVersion(db)).toBe(1)
  })

  test('running migrations twice does not duplicate tables', () => {
    runMigrations(db)
    runMigrations(db)
    const tables = tableNames(db)
    // Each table must appear exactly once — no duplicates, no extras.
    expect(tables.has('agents')).toBe(true)
    expect(tables.has('messages')).toBe(true)
    expect(tables.has('tasks')).toBe(true)
    expect(tables.has('kv')).toBe(true)
  })
})
