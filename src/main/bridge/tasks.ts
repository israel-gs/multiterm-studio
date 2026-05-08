import { randomUUID } from 'crypto'
import type { Database } from 'better-sqlite3'
import { ERROR_CODES } from './protocol'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'claimed' | 'completed' | 'released' | 'failed'

export interface TaskRecord {
  id: string
  name: string
  body: string | null
  createdBy: string
  ownedBy: string | null
  status: TaskStatus
  createdAt: number
  updatedAt: number
}

/**
 * Error thrown by all task operations when a constraint is violated.
 * Carries a JSON-RPC error code so the dispatcher can convert directly.
 */
export class BridgeError extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
  }
}

// ── State machine ─────────────────────────────────────────────────────────────

/**
 * Valid transitions for the task state machine.
 * Key = current status; value = set of statuses the operation can produce.
 *
 * pending  → claimed   (claimTask)
 * claimed  → completed (completeTask)
 * claimed  → pending   (releaseTask — shown as 'pending' again)
 * claimed  → failed    (failTask)
 */
const VALID_TRANSITIONS: Record<string, readonly TaskStatus[]> = {
  pending: ['claimed'],
  claimed: ['completed', 'pending', 'failed']
}

function assertValidTransition(current: TaskStatus, next: TaskStatus): void {
  const allowed = VALID_TRANSITIONS[current] ?? []
  if (!(allowed as readonly string[]).includes(next)) {
    throw new BridgeError(
      ERROR_CODES.TaskStateInvalid,
      `Cannot transition task from "${current}" to "${next}".`
    )
  }
}

// ── Row helpers ───────────────────────────────────────────────────────────────

type DbRow = {
  id: string
  name: string
  body: string | null
  created_by: string
  owned_by: string | null
  status: string
  created_at: number
  updated_at: number
}

function rowToRecord(row: DbRow): TaskRecord {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdBy: row.created_by,
    ownedBy: row.owned_by,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getTask(db: Database, id: string): DbRow {
  const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as DbRow | undefined
  if (!row) {
    throw new BridgeError(ERROR_CODES.TaskNotFound, `Task "${id}" not found.`)
  }
  return row
}

// ── Public functions ──────────────────────────────────────────────────────────

/**
 * Creates a new task with status `pending`. The id is server-assigned (UUID).
 * Throws -32602 if name is empty or whitespace-only.
 */
export function createTask(db: Database, paneId: string, name: string, body?: string): TaskRecord {
  if (!name || name.trim().length === 0) {
    throw new BridgeError(-32602, 'Task name must be a non-empty string.')
  }

  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO tasks (id, name, body, created_by, owned_by, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?)`
  ).run(id, name, body ?? null, paneId, now, now)

  return {
    id,
    name,
    body: body ?? null,
    createdBy: paneId,
    ownedBy: null,
    status: 'pending',
    createdAt: now,
    updatedAt: now
  }
}

/**
 * Atomically claims a pending task for `paneId`.
 * Uses a transaction that first verifies the task is still pending before
 * updating — if another process claimed it concurrently, the status check
 * will fail and the transaction rolls back, throwing -32031.
 */
export function claimTask(db: Database, paneId: string, taskId: string): TaskRecord {
  return db.transaction(() => {
    const row = getTask(db, taskId)
    assertValidTransition(row.status as TaskStatus, 'claimed')

    const now = Date.now()
    db.prepare(
      `UPDATE tasks SET owned_by = ?, status = 'claimed', updated_at = ? WHERE id = ?`
    ).run(paneId, now, taskId)

    return rowToRecord({ ...row, owned_by: paneId, status: 'claimed', updated_at: now })
  })()
}

/**
 * Marks a claimed task as `completed`. Only the owning pane may do this.
 * Throws -32001 (NotOwner) or -32031 (TaskStateInvalid) on violation.
 */
export function completeTask(db: Database, paneId: string, taskId: string): TaskRecord {
  return db.transaction(() => {
    const row = getTask(db, taskId)
    assertValidTransition(row.status as TaskStatus, 'completed')
    assertOwnership(row, paneId)

    const now = Date.now()
    db.prepare(`UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ?`).run(
      now,
      taskId
    )

    return rowToRecord({ ...row, status: 'completed', updated_at: now })
  })()
}

/**
 * Releases a claimed task back to `pending`, clearing the owner.
 * Only the owning pane may release. Throws -32001 or -32031.
 */
export function releaseTask(db: Database, paneId: string, taskId: string): TaskRecord {
  return db.transaction(() => {
    const row = getTask(db, taskId)
    assertValidTransition(row.status as TaskStatus, 'pending')
    assertOwnership(row, paneId)

    const now = Date.now()
    db.prepare(
      `UPDATE tasks SET status = 'pending', owned_by = NULL, updated_at = ? WHERE id = ?`
    ).run(now, taskId)

    return rowToRecord({ ...row, status: 'pending', owned_by: null, updated_at: now })
  })()
}

/**
 * Marks a claimed task as `failed`. Only the owning pane may do this.
 * Throws -32001 or -32031 on violation.
 */
export function failTask(db: Database, paneId: string, taskId: string): TaskRecord {
  return db.transaction(() => {
    const row = getTask(db, taskId)
    assertValidTransition(row.status as TaskStatus, 'failed')
    assertOwnership(row, paneId)

    const now = Date.now()
    db.prepare(`UPDATE tasks SET status = 'failed', updated_at = ? WHERE id = ?`).run(now, taskId)

    return rowToRecord({ ...row, status: 'failed', updated_at: now })
  })()
}

/**
 * Lists tasks with optional filters.
 * - `status`: single status string OR array of statuses.
 * - `ownedBy`: pane id that owns the task.
 * Results are ordered by `createdAt` ascending.
 */
export function listTasks(
  db: Database,
  filters: { status?: string | string[]; ownedBy?: string }
): TaskRecord[] {
  const conditions: string[] = []
  const bindings: unknown[] = []

  if (filters.status !== undefined) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
    const placeholders = statuses.map(() => '?').join(', ')
    conditions.push(`status IN (${placeholders})`)
    bindings.push(...statuses)
  }

  if (filters.ownedBy !== undefined) {
    conditions.push(`owned_by = ?`)
    bindings.push(filters.ownedBy)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM tasks ${where} ORDER BY created_at ASC`)
    .all(...bindings) as DbRow[]

  return rows.map(rowToRecord)
}

// ── Private helpers ───────────────────────────────────────────────────────────

function assertOwnership(row: DbRow, paneId: string): void {
  if (row.owned_by !== paneId) {
    throw new BridgeError(
      ERROR_CODES.NotOwner,
      `Task "${row.id}" is owned by "${row.owned_by}", not "${paneId}".`
    )
  }
}
