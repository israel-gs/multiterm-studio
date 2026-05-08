/** @vitest-environment node */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomBytes } from 'crypto'
import { unlinkSync, existsSync } from 'fs'
import type { Database } from 'better-sqlite3'
import { openDb, runMigrations } from '../../../src/main/bridge/db'
import { ERROR_CODES } from '../../../src/main/bridge/protocol'
import { kvSet, kvGet, kvDel, kvList } from '../../../src/main/bridge/kv'

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

// ── Scalar operations ─────────────────────────────────────────────────────────

describe('kvSet / kvGet round-trip', () => {
  test('set then get returns the stored value', () => {
    kvSet(db, 'feature.flag', 'enabled')
    const result = kvGet(db, 'feature.flag')
    expect(result).toEqual({ value: 'enabled' })
  })

  test('get missing key returns { value: null } (not an error)', () => {
    const result = kvGet(db, 'unknown')
    expect(result).toEqual({ value: null })
  })

  test('overwrite existing key with new value', () => {
    kvSet(db, 'k', 'first')
    kvSet(db, 'k', 'second')
    expect(kvGet(db, 'k')).toEqual({ value: 'second' })
  })
})

describe('kvDel', () => {
  test('delete existing key returns { deleted: true }', () => {
    kvSet(db, 'x', '1')
    const result = kvDel(db, 'x')
    expect(result).toEqual({ deleted: true })
  })

  test('get after delete returns { value: null }', () => {
    kvSet(db, 'x', '1')
    kvDel(db, 'x')
    expect(kvGet(db, 'x')).toEqual({ value: null })
  })

  test('delete missing key returns { deleted: false } (not an error)', () => {
    const result = kvDel(db, 'x')
    expect(result).toEqual({ deleted: false })
  })
})

// ── Key validation ────────────────────────────────────────────────────────────

describe('key constraints', () => {
  test('valid key with dots and colons is accepted', () => {
    const result = kvSet(db, 'a.b:c/d-e', 'val')
    expect(result).not.toHaveProperty('error')
  })

  test('empty key returns -32050 (KVKeyInvalid)', () => {
    const result = kvSet(db, '', 'val')
    expect(result).toEqual({
      error: { code: ERROR_CODES.KVKeyInvalid, message: expect.any(String) }
    })
  })

  test('key with space returns -32050', () => {
    const result = kvSet(db, 'foo bar', 'val')
    expect(result).toEqual({
      error: { code: ERROR_CODES.KVKeyInvalid, message: expect.any(String) }
    })
  })

  test('key with disallowed character (!) returns -32050', () => {
    const result = kvSet(db, 'foo!bar', 'val')
    expect(result).toEqual({
      error: { code: ERROR_CODES.KVKeyInvalid, message: expect.any(String) }
    })
  })

  test('key of exactly 256 bytes is accepted', () => {
    const key = 'a'.repeat(256)
    const result = kvSet(db, key, 'val')
    expect(result).not.toHaveProperty('error')
  })

  test('key of 257 bytes returns -32050', () => {
    const key = 'a'.repeat(257)
    const result = kvSet(db, key, 'val')
    expect(result).toEqual({
      error: { code: ERROR_CODES.KVKeyInvalid, message: expect.any(String) }
    })
  })

  test('kvGet with invalid key also returns -32050', () => {
    const result = kvGet(db, 'bad key!')
    expect(result).toEqual({
      error: { code: ERROR_CODES.KVKeyInvalid, message: expect.any(String) }
    })
  })

  test('kvDel with invalid key returns -32050', () => {
    const result = kvDel(db, '')
    expect(result).toEqual({
      error: { code: ERROR_CODES.KVKeyInvalid, message: expect.any(String) }
    })
  })
})

// ── Value constraints ─────────────────────────────────────────────────────────

describe('value constraints', () => {
  test('value of exactly 64 KiB is accepted', () => {
    const value = 'x'.repeat(64 * 1024)
    const result = kvSet(db, 'k', value)
    expect(result).not.toHaveProperty('error')
  })

  test('value of 64 KiB + 1 byte returns -32602 (Invalid params)', () => {
    const value = 'x'.repeat(64 * 1024 + 1)
    const result = kvSet(db, 'k', value)
    expect(result).toEqual({ error: { code: -32602, message: expect.stringContaining('64 KiB') } })
  })
})

// ── Listing ───────────────────────────────────────────────────────────────────

describe('kvList', () => {
  beforeEach(() => {
    kvSet(db, 'a.1', 'v1')
    kvSet(db, 'a.2', 'v2')
    kvSet(db, 'b.1', 'v3')
  })

  test('list without prefix returns all keys', () => {
    const result = kvList(db)
    expect(result).toHaveLength(3)
  })

  test('list with prefix returns matching keys only', () => {
    const result = kvList(db, 'a.')
    expect(result).toHaveLength(2)
    const keys = result.map((r) => r.key)
    expect(keys).toContain('a.1')
    expect(keys).toContain('a.2')
    expect(keys).not.toContain('b.1')
  })

  test('each entry has key and value', () => {
    const result = kvList(db, 'a.')
    for (const entry of result) {
      expect(entry).toHaveProperty('key')
      expect(entry).toHaveProperty('value')
    }
  })

  test('list returns entries sorted by key ascending', () => {
    const result = kvList(db)
    const keys = result.map((r) => r.key)
    expect(keys).toEqual([...keys].sort())
  })

  test('list with prefix that matches nothing returns empty array', () => {
    const result = kvList(db, 'z.')
    expect(result).toEqual([])
  })

  test('list without prefix returns empty array when store is empty', () => {
    kvDel(db, 'a.1')
    kvDel(db, 'a.2')
    kvDel(db, 'b.1')
    expect(kvList(db)).toEqual([])
  })
})

// ── Persistence across DB reopen ──────────────────────────────────────────────

describe('persistence', () => {
  test('value survives DB close and reopen', () => {
    const dbPath = join(tmpdir(), `mts-kv-test-${randomBytes(4).toString('hex')}.db`)
    try {
      const db1 = openDb(dbPath)
      runMigrations(db1)
      kvSet(db1, 'persist.key', 'hello')
      db1.close()

      const db2 = openDb(dbPath)
      runMigrations(db2)
      const result = kvGet(db2, 'persist.key')
      db2.close()

      expect(result).toEqual({ value: 'hello' })
    } finally {
      if (existsSync(dbPath)) unlinkSync(dbPath)
      // WAL leaves shm and wal files; clean those up too.
      for (const ext of ['-shm', '-wal']) {
        const p = dbPath + ext
        if (existsSync(p)) unlinkSync(p)
      }
    }
  })
})
