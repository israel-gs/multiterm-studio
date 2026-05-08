import type { Database } from 'better-sqlite3'
import { ERROR_CODES } from './protocol'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentRecord {
  paneId: string
  alias: string | null
  createdAt: number
  lastSeenAt: number
}

/** Discriminated union returned by operations that can fail. */
type Ok = { ok: true }
type Err = { error: { code: number; message: string } }
type Result = Ok | Err
type ResolveResult = { paneId: string } | Err

// ── Alias validation ──────────────────────────────────────────────────────────

/** Alias stored without the leading '@'; must match [A-Za-z0-9_-]+ */
const ALIAS_RE = /^[A-Za-z0-9_-]+$/

function validateAlias(alias: string): Err | null {
  if (alias.length === 0 || !ALIAS_RE.test(alias)) {
    return {
      error: {
        code: -32602,
        message: `Invalid alias format "${alias}". Must match [A-Za-z0-9_-]+ and be non-empty.`
      }
    }
  }
  return null
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Records that a pane is alive. Creates the agent row on first call; on
 * subsequent calls updates last_seen_at. If the pane was previously
 * deregistered, it is reactivated.
 */
export function touchAgent(db: Database, paneId: string): void {
  const now = Date.now()
  // Use INSERT OR IGNORE + UPDATE rather than UPSERT so we can preserve
  // created_at on subsequent touches without reading the row first.
  db.prepare(
    `INSERT INTO agents (pane_id, alias, active, created_at, last_seen_at)
     VALUES (?, NULL, 1, ?, ?)
     ON CONFLICT (pane_id) DO UPDATE SET
       last_seen_at = excluded.last_seen_at,
       active = 1`
  ).run(paneId, now, now)
}

/**
 * Assigns or clears the alias for a pane.
 *
 * - `alias = null` clears the current alias (making it available to others).
 * - Alias must match `[A-Za-z0-9_-]+`; otherwise returns -32602.
 * - If another active pane holds the alias returns -32021 AliasCollision.
 * - Re-assigning the same alias to the same pane is idempotent (ok).
 */
export function setAlias(db: Database, paneId: string, alias: string | null): Result {
  if (alias !== null) {
    const err = validateAlias(alias)
    if (err) return err

    // Check if another ACTIVE pane (not this pane) already holds the alias.
    const holder = db
      .prepare(
        `SELECT pane_id FROM agents
         WHERE alias = ? AND active = 1 AND pane_id != ?`
      )
      .get(alias, paneId) as { pane_id: string } | undefined

    if (holder) {
      return {
        error: {
          code: ERROR_CODES.AliasCollision,
          message: `Alias "${alias}" is already held by pane ${holder.pane_id}.`
        }
      }
    }
  }

  db.prepare(`UPDATE agents SET alias = ? WHERE pane_id = ?`).run(alias, paneId)
  return { ok: true }
}

/**
 * Resolves a target string to a pane id.
 * Accepts:
 *   - `@alias` — looks up by alias among active panes.
 *   - `pane-<id>` or any raw string — looks up by pane_id among active panes.
 * Returns PaneNotFound (-32020) if no active match exists.
 */
export function resolveTarget(db: Database, target: string): ResolveResult {
  if (target.startsWith('@')) {
    const alias = target.slice(1)
    const row = db
      .prepare(`SELECT pane_id FROM agents WHERE alias = ? AND active = 1`)
      .get(alias) as { pane_id: string } | undefined

    if (!row) {
      return {
        error: {
          code: ERROR_CODES.PaneNotFound,
          message: `No active pane with alias "${target}".`
        }
      }
    }
    return { paneId: row.pane_id }
  }

  // Raw pane id lookup.
  const row = db
    .prepare(`SELECT pane_id FROM agents WHERE pane_id = ? AND active = 1`)
    .get(target) as { pane_id: string } | undefined

  if (!row) {
    return {
      error: {
        code: ERROR_CODES.PaneNotFound,
        message: `No active pane with id "${target}".`
      }
    }
  }
  return { paneId: row.pane_id }
}

/**
 * Marks a pane as inactive and clears its alias so that other panes can
 * claim it. A no-op if the pane does not exist.
 */
export function deregisterAgent(db: Database, paneId: string): void {
  db.prepare(`UPDATE agents SET active = 0, alias = NULL WHERE pane_id = ?`).run(paneId)
}

/**
 * Returns all active registered panes ordered by lastSeenAt descending.
 */
export function listActiveAgents(db: Database): AgentRecord[] {
  const rows = db
    .prepare(
      `SELECT pane_id, alias, created_at, last_seen_at
       FROM agents
       WHERE active = 1
       ORDER BY last_seen_at DESC`
    )
    .all() as Array<{
    pane_id: string
    alias: string | null
    created_at: number
    last_seen_at: number
  }>

  return rows.map((r) => ({
    paneId: r.pane_id,
    alias: r.alias,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at
  }))
}
