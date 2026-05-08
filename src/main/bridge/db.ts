import BetterSqlite3 from 'better-sqlite3'
import type { Database } from 'better-sqlite3'

// Re-export the type so callers can reference it without importing better-sqlite3 directly.
export type { Database }

// ── V1 schema ─────────────────────────────────────────────────────────────────

/**
 * Complete DDL for schema version 1.
 * All tables use CREATE TABLE IF NOT EXISTS so runMigrations is safe to call
 * multiple times (idempotent).
 */
const V1_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS agents (
  pane_id      TEXT PRIMARY KEY,
  alias        TEXT UNIQUE,
  active       INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  from_pane   TEXT NOT NULL,
  to_pane     TEXT NOT NULL,
  body        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('send', 'notify')),
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT,
  created_by TEXT NOT NULL,
  owned_by   TEXT,
  status     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

// ── V2 migration ──────────────────────────────────────────────────────────────

/**
 * V2 adds `response_text` to the messages table so that `acceptMessage` can
 * persist an optional reply string typed by the user in the modal.
 * Uses ALTER TABLE … ADD COLUMN because the table already exists from V1.
 */
const V2_ALTER_MESSAGES = `
ALTER TABLE messages ADD COLUMN response_text TEXT;
`

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Opens a better-sqlite3 database at the given path (use ':memory:' for tests).
 * WAL mode is enabled for file-backed databases; :memory: databases silently
 * retain the 'memory' journal mode which is equivalent for single-process use.
 */
export function openDb(path: string): Database {
  const db = new BetterSqlite3(path)
  // WAL journal mode gives better concurrency for the bridge's read-heavy
  // workload (many CLI processes reading while the daemon writes).
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * Applies all pending migrations up to the current version.
 * Safe to call multiple times — each migration checks before applying.
 */
export function runMigrations(db: Database): void {
  applyV1(db)
  applyV2(db)
}

// ── Migration implementations ─────────────────────────────────────────────────

function applyV2(db: Database): void {
  const row = db.prepare('SELECT version FROM schema_version').get() as
    | { version: number }
    | undefined
  if ((row?.version ?? 0) >= 2) return

  // Guard against duplicate-column errors from partial migrations (e.g. a DB
  // file that already has the column but whose schema_version was not bumped).
  const cols = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
  const hasResponseText = cols.some((c) => c.name === 'response_text')

  // ALTER TABLE … ADD COLUMN cannot run inside a SQLite transaction, so we
  // execute it directly and then update the version record.
  if (!hasResponseText) {
    db.exec(V2_ALTER_MESSAGES)
  }
  db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (2)').run()
}

function applyV1(db: Database): void {
  // Check current version first to keep the runner idempotent.
  const existingTables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`)
    .all() as Array<{ name: string }>

  if (existingTables.length > 0) {
    const row = db.prepare('SELECT version FROM schema_version').get() as
      | { version: number }
      | undefined
    if ((row?.version ?? 0) >= 1) return
  }

  // Run the full DDL in a single transaction so either all tables are created
  // or none are (crash safety).
  db.transaction(() => {
    db.exec(V1_SCHEMA)
    // Upsert the version so re-running after a partial failure is safe.
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (1)').run()
  })()
}
