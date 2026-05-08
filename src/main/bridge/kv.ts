import type { Database } from 'better-sqlite3'
import { ERROR_CODES } from './protocol'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface KvEntry {
  key: string
  value: string
}

type KvSetResult = { ok: true } | { error: { code: number; message: string } }
type KvGetResult = { value: string | null } | { error: { code: number; message: string } }
type KvDelResult = { deleted: boolean } | { error: { code: number; message: string } }
type KvListResult = KvEntry[]

// ── Constraints ───────────────────────────────────────────────────────────────

/** Max key size in UTF-8 bytes. */
const KEY_MAX_BYTES = 256

/** Max value size in UTF-8 bytes (64 KiB). */
const VALUE_MAX_BYTES = 64 * 1024

/** Allowed key character set: [A-Za-z0-9._:/-]+ */
const KEY_RE = /^[A-Za-z0-9._:/-]+$/

function validateKey(key: string): { error: { code: number; message: string } } | null {
  if (key.length === 0 || !KEY_RE.test(key)) {
    return {
      error: {
        code: ERROR_CODES.KVKeyInvalid,
        message: `Invalid key "${key}". Must match [A-Za-z0-9._:/\\-]+ and be non-empty.`
      }
    }
  }
  // Byte-length check (UTF-8 may exceed char count for non-ASCII characters).
  const byteLen = Buffer.byteLength(key, 'utf8')
  if (byteLen > KEY_MAX_BYTES) {
    return {
      error: {
        code: ERROR_CODES.KVKeyInvalid,
        message: `Key exceeds the ${KEY_MAX_BYTES}-byte limit (got ${byteLen} bytes).`
      }
    }
  }
  return null
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Sets (inserts or replaces) a key-value pair.
 * Returns -32050 for invalid keys; -32602 if value exceeds 64 KiB.
 */
export function kvSet(db: Database, key: string, value: string): KvSetResult {
  const keyErr = validateKey(key)
  if (keyErr) return keyErr

  const valueBytes = Buffer.byteLength(value, 'utf8')
  if (valueBytes > VALUE_MAX_BYTES) {
    return {
      error: {
        code: -32602,
        message: `Value exceeds the 64 KiB limit (got ${valueBytes} bytes).`
      }
    }
  }

  db.prepare(
    `INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
  ).run(key, value)
  return { ok: true }
}

/**
 * Gets the value for a key.
 * Returns `{ value: null }` (not an error) when the key does not exist.
 * Returns -32050 for invalid keys.
 */
export function kvGet(db: Database, key: string): KvGetResult {
  const keyErr = validateKey(key)
  if (keyErr) return keyErr

  const row = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as
    | { value: string }
    | undefined

  return { value: row?.value ?? null }
}

/**
 * Deletes a key.
 * Returns `{ deleted: true }` if the key existed, `{ deleted: false }` if not.
 * Returns -32050 for invalid keys.
 */
export function kvDel(db: Database, key: string): KvDelResult {
  const keyErr = validateKey(key)
  if (keyErr) return keyErr

  const info = db.prepare(`DELETE FROM kv WHERE key = ?`).run(key)
  return { deleted: info.changes > 0 }
}

/**
 * Lists all KV entries, optionally filtered by a key prefix.
 * Results are sorted by key ascending.
 */
export function kvList(db: Database, prefix?: string): KvListResult {
  if (prefix !== undefined && prefix.length > 0) {
    const rows = db
      .prepare(`SELECT key, value FROM kv WHERE key LIKE ? ESCAPE '\\' ORDER BY key ASC`)
      .all(escapeLikePrefix(prefix) + '%') as KvEntry[]
    return rows
  }
  return db.prepare(`SELECT key, value FROM kv ORDER BY key ASC`).all() as KvEntry[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Escapes special SQLite LIKE metacharacters in a prefix string so that the
 * LIKE clause matches only literal characters.
 */
function escapeLikePrefix(prefix: string): string {
  // Escape backslash first, then % and _.
  return prefix.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
