/** @vitest-environment node */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import type { Database } from 'better-sqlite3'
import { openDb, runMigrations } from '../../../src/main/bridge/db'
import { ERROR_CODES } from '../../../src/main/bridge/protocol'
import { touchAgent } from '../../../src/main/bridge/registry'
import {
  createTask,
  claimTask,
  completeTask,
  releaseTask,
  failTask,
  listTasks
} from '../../../src/main/bridge/tasks'

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: Database

beforeEach(() => {
  db = openDb(':memory:')
  runMigrations(db)
  // Register panes used across suites
  touchAgent(db, 'pane-a')
  touchAgent(db, 'pane-b')
})

afterEach(() => {
  try {
    db.close()
  } catch {
    /* ignore */
  }
})

// ── createTask ────────────────────────────────────────────────────────────────

describe('createTask', () => {
  test('returns a task with a server-assigned id and pending status', () => {
    const task = createTask(db, 'pane-a', 'fix-login')
    expect(task.id).toBeTruthy()
    expect(task.status).toBe('pending')
    expect(task.name).toBe('fix-login')
    expect(task.createdBy).toBe('pane-a')
    expect(task.ownedBy).toBeNull()
    expect(task.body).toBeNull()
    expect(typeof task.createdAt).toBe('number')
    expect(typeof task.updatedAt).toBe('number')
  })

  test('accepts an optional body', () => {
    const task = createTask(db, 'pane-a', 'fix-login', 'description text')
    expect(task.body).toBe('description text')
  })

  test('generates unique ids across multiple calls', () => {
    const t1 = createTask(db, 'pane-a', 'task-1')
    const t2 = createTask(db, 'pane-a', 'task-2')
    expect(t1.id).not.toBe(t2.id)
  })

  test('empty name throws error with code -32602', () => {
    expect(() => createTask(db, 'pane-a', '')).toThrow(expect.objectContaining({ code: -32602 }))
  })

  test('whitespace-only name throws error with code -32602', () => {
    expect(() => createTask(db, 'pane-a', '   ')).toThrow(expect.objectContaining({ code: -32602 }))
  })

  test('task is persisted and readable from the DB', () => {
    const task = createTask(db, 'pane-a', 'persist-me')
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as
      | { id: string; name: string; status: string }
      | undefined
    expect(row).toBeDefined()
    expect(row!.name).toBe('persist-me')
    expect(row!.status).toBe('pending')
  })
})

// ── claimTask ─────────────────────────────────────────────────────────────────

describe('claimTask', () => {
  test('transitions pending task to claimed and sets ownedBy', () => {
    const { id } = createTask(db, 'pane-a', 'claim-me')
    const task = claimTask(db, 'pane-b', id)
    expect(task.status).toBe('claimed')
    expect(task.ownedBy).toBe('pane-b')
  })

  test('throws -32031 when task is already claimed (invalid transition)', () => {
    const { id } = createTask(db, 'pane-a', 'already-claimed')
    claimTask(db, 'pane-a', id)
    expect(() => claimTask(db, 'pane-b', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskStateInvalid })
    )
  })

  test('throws -32031 when task is completed', () => {
    const { id } = createTask(db, 'pane-a', 'done')
    claimTask(db, 'pane-a', id)
    completeTask(db, 'pane-a', id)
    expect(() => claimTask(db, 'pane-b', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskStateInvalid })
    )
  })

  test('throws -32030 for unknown task id', () => {
    expect(() => claimTask(db, 'pane-a', 'nonexistent-id')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskNotFound })
    )
  })

  test('atomic claim under contention: exactly one pane wins', () => {
    // This test uses the SQLite transaction atomicity. We simulate contention
    // by interleaving claim attempts in the same process using two calls.
    // The SQLite SERIALIZABLE isolation ensures only one wins.
    const { id } = createTask(db, 'pane-a', 'contested')

    let successCount = 0
    let failCount = 0

    for (const pane of ['pane-a', 'pane-b']) {
      try {
        claimTask(db, pane, id)
        successCount++
      } catch (err: unknown) {
        const bridgeErr = err as { code: number }
        if (bridgeErr.code === ERROR_CODES.TaskStateInvalid) {
          failCount++
        } else {
          throw err
        }
      }
    }

    expect(successCount).toBe(1)
    expect(failCount).toBe(1)
  })
})

// ── completeTask ──────────────────────────────────────────────────────────────

describe('completeTask', () => {
  test('transitions claimed task to completed', () => {
    const { id } = createTask(db, 'pane-a', 'work')
    claimTask(db, 'pane-a', id)
    const task = completeTask(db, 'pane-a', id)
    expect(task.status).toBe('completed')
  })

  test('throws -32001 (NotOwner) when non-owner attempts to complete', () => {
    const { id } = createTask(db, 'pane-a', 'owned-task')
    claimTask(db, 'pane-a', id)
    expect(() => completeTask(db, 'pane-b', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.NotOwner })
    )
  })

  test('throws -32031 when task is pending (not yet claimed)', () => {
    const { id } = createTask(db, 'pane-a', 'not-claimed')
    expect(() => completeTask(db, 'pane-a', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskStateInvalid })
    )
  })

  test('throws -32030 for unknown task id', () => {
    expect(() => completeTask(db, 'pane-a', 'ghost-id')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskNotFound })
    )
  })
})

// ── releaseTask ───────────────────────────────────────────────────────────────

describe('releaseTask', () => {
  test('transitions claimed task back to pending and clears ownedBy', () => {
    const { id } = createTask(db, 'pane-a', 'releaseable')
    claimTask(db, 'pane-a', id)
    const task = releaseTask(db, 'pane-a', id)
    expect(task.status).toBe('pending')
    expect(task.ownedBy).toBeNull()
  })

  test('allows a different pane to claim after release', () => {
    const { id } = createTask(db, 'pane-a', 'requeue')
    claimTask(db, 'pane-a', id)
    releaseTask(db, 'pane-a', id)
    const task = claimTask(db, 'pane-b', id)
    expect(task.ownedBy).toBe('pane-b')
  })

  test('throws -32001 (NotOwner) when non-owner attempts to release', () => {
    const { id } = createTask(db, 'pane-a', 'owned')
    claimTask(db, 'pane-a', id)
    expect(() => releaseTask(db, 'pane-b', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.NotOwner })
    )
  })

  test('throws -32031 when task is pending (not claimed)', () => {
    const { id } = createTask(db, 'pane-a', 'not-claimed')
    expect(() => releaseTask(db, 'pane-a', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskStateInvalid })
    )
  })
})

// ── failTask ──────────────────────────────────────────────────────────────────

describe('failTask', () => {
  test('transitions claimed task to failed', () => {
    const { id } = createTask(db, 'pane-a', 'failing')
    claimTask(db, 'pane-a', id)
    const task = failTask(db, 'pane-a', id)
    expect(task.status).toBe('failed')
  })

  test('throws -32001 (NotOwner) when non-owner attempts to fail', () => {
    const { id } = createTask(db, 'pane-a', 'owned')
    claimTask(db, 'pane-a', id)
    expect(() => failTask(db, 'pane-b', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.NotOwner })
    )
  })

  test('throws -32031 when task is pending', () => {
    const { id } = createTask(db, 'pane-a', 'not-claimed')
    expect(() => failTask(db, 'pane-a', id)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.TaskStateInvalid })
    )
  })
})

// ── listTasks ─────────────────────────────────────────────────────────────────

describe('listTasks', () => {
  test('returns all tasks when no filter is provided', () => {
    createTask(db, 'pane-a', 'task-1')
    createTask(db, 'pane-a', 'task-2')
    createTask(db, 'pane-b', 'task-3')
    expect(listTasks(db, {})).toHaveLength(3)
  })

  test('returns empty array when no tasks exist', () => {
    expect(listTasks(db, {})).toHaveLength(0)
  })

  test('filters by single status string', () => {
    const t1 = createTask(db, 'pane-a', 'p1')
    const t2 = createTask(db, 'pane-a', 'p2')
    const t3 = createTask(db, 'pane-a', 'p3')
    claimTask(db, 'pane-a', t2.id)
    completeTask(db, 'pane-a', t2.id)
    claimTask(db, 'pane-b', t3.id)

    const pending = listTasks(db, { status: 'pending' })
    expect(pending).toHaveLength(1)
    expect(pending[0].id).toBe(t1.id)
  })

  test('filters by array of statuses', () => {
    const t1 = createTask(db, 'pane-a', 'p1')
    const t2 = createTask(db, 'pane-a', 'p2')
    claimTask(db, 'pane-a', t2.id)

    const result = listTasks(db, { status: ['pending', 'claimed'] })
    expect(result).toHaveLength(2)
    const ids = result.map((t) => t.id)
    expect(ids).toContain(t1.id)
    expect(ids).toContain(t2.id)
  })

  test('filters by ownedBy', () => {
    const t1 = createTask(db, 'pane-a', 'for-a')
    const t2 = createTask(db, 'pane-a', 'for-b')
    claimTask(db, 'pane-a', t1.id)
    claimTask(db, 'pane-b', t2.id)

    const result = listTasks(db, { ownedBy: 'pane-a' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(t1.id)
  })

  test('combines status and ownedBy filters', () => {
    const t1 = createTask(db, 'pane-a', 'claimed-by-a')
    const t2 = createTask(db, 'pane-a', 'claimed-by-b')
    claimTask(db, 'pane-a', t1.id)
    claimTask(db, 'pane-b', t2.id)

    const result = listTasks(db, { status: 'claimed', ownedBy: 'pane-a' })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe(t1.id)
  })

  test('results are ordered by createdAt ascending', async () => {
    const t1 = createTask(db, 'pane-a', 'first')
    await new Promise((r) => setTimeout(r, 5))
    const t2 = createTask(db, 'pane-a', 'second')
    await new Promise((r) => setTimeout(r, 5))
    const t3 = createTask(db, 'pane-a', 'third')

    const result = listTasks(db, {})
    expect(result[0].id).toBe(t1.id)
    expect(result[1].id).toBe(t2.id)
    expect(result[2].id).toBe(t3.id)
  })
})

// ── Persistence ───────────────────────────────────────────────────────────────

describe('persistence across DB reopen', () => {
  test('task survives DB reopen and retains claimed status', () => {
    // Write into a temp file path so we can close and reopen
    const tmpPath = `/tmp/multiterm-tasks-test-${Date.now()}.db`
    const db1 = openDb(tmpPath)
    runMigrations(db1)

    const { id } = createTask(db1, 'pane-a', 'durable-task')
    claimTask(db1, 'pane-a', id)
    db1.close()

    const db2 = openDb(tmpPath)
    runMigrations(db2)
    const tasks = listTasks(db2, { status: 'claimed' })
    db2.close()

    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe(id)
    expect(tasks[0].ownedBy).toBe('pane-a')
  })
})
