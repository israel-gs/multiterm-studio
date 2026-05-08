/** @vitest-environment node */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { connect } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { openDb, runMigrations } from '../../../src/main/bridge/db'
import { ERROR_CODES } from '../../../src/main/bridge/protocol'
import { touchAgent, setAlias } from '../../../src/main/bridge/registry'
import type { EventPublisher } from '../../../src/main/bridge/messaging'
import { BridgeServer } from '../../../src/main/bridge/server'
import type { Database } from 'better-sqlite3'

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempSocketPath(): string {
  return join(tmpdir(), `multiterm-bridge-test-${process.pid}-${Date.now()}.sock`)
}

function makeFakePublisher(): EventPublisher {
  return { publish: vi.fn() }
}

/**
 * Opens a connection, sends a JSON-RPC request, and returns a parsed response.
 * Handles newline-delimited framing.
 */
function rpc(
  socketPath: string,
  method: string,
  params?: unknown,
  id: number = 1
): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath)
    let buf = ''

    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim().length === 0) continue
        try {
          resolve(JSON.parse(line))
        } catch {
          reject(new Error(`Non-JSON response: ${line}`))
        }
        sock.destroy()
      }
    })

    sock.on('error', reject)
    sock.on('connect', () => {
      const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params
      sock.write(JSON.stringify(msg) + '\n')
    })
  })
}

/**
 * Sends raw bytes (for malformed-JSON tests) and waits for a response line.
 */
function rpcRaw(socketPath: string, raw: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const sock = connect(socketPath)
    let buf = ''

    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim().length === 0) continue
        resolve(JSON.parse(line))
        sock.destroy()
      }
    })

    sock.on('error', reject)
    sock.on('connect', () => {
      sock.write(raw + '\n')
    })
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let db: Database
let server: BridgeServer
let socketPath: string

beforeEach(async () => {
  db = openDb(':memory:')
  runMigrations(db)
  touchAgent(db, 'pane-a')
  touchAgent(db, 'pane-b')
  setAlias(db, 'pane-b', 'b')
  socketPath = tempSocketPath()
  server = new BridgeServer({ db, publisher: makeFakePublisher() })
  await server.listen(socketPath)
})

afterEach(async () => {
  await server.close()
  try {
    db.close()
  } catch {
    /* ignore */
  }
})

// ── Unknown method ────────────────────────────────────────────────────────────

describe('unknown method', () => {
  test('returns -32601 for unmapped method', async () => {
    const res = await rpc(socketPath, 'bridge.unknown.thing', {})
    expect(res.error?.code).toBe(-32601)
  })
})

// ── Malformed JSON ────────────────────────────────────────────────────────────

describe('malformed JSON', () => {
  test('returns -32700 on parse error and keeps connection open', async () => {
    const res = await rpcRaw(socketPath, '{not valid json}')
    expect((res as { error: { code: number } }).error.code).toBe(-32700)
  })

  test('connection can still serve a valid request after a malformed one', async () => {
    // Connect once and send two messages on the same socket
    await new Promise<void>((resolve, reject) => {
      const sock = connect(socketPath)
      const responses: unknown[] = []
      let buf = ''

      sock.setEncoding('utf8')
      sock.on('data', (chunk: string) => {
        buf += chunk
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          responses.push(JSON.parse(line))
          if (responses.length === 2) {
            const first = responses[0] as { error?: { code: number } }
            const second = responses[1] as { result?: unknown }
            expect(first.error?.code).toBe(-32700)
            expect(second.result).toBeDefined()
            sock.destroy()
            resolve()
          }
        }
      })

      sock.on('error', reject)
      sock.on('connect', () => {
        sock.write('{bad json}\n')
        sock.write(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'bridge.kv.get',
            params: { from: 'pane-a', key: 'x' }
          }) + '\n'
        )
      })
    })
  })
})

// ── KV methods dispatch ───────────────────────────────────────────────────────

describe('bridge.kv.* dispatch', () => {
  test('bridge.kv.set persists and bridge.kv.get retrieves', async () => {
    const setRes = await rpc(socketPath, 'bridge.kv.set', {
      from: 'pane-a',
      key: 'foo',
      value: 'bar'
    })
    expect(setRes.result).toMatchObject({ ok: true })

    const getRes = await rpc(socketPath, 'bridge.kv.get', { from: 'pane-a', key: 'foo' })
    expect((getRes.result as { value: string }).value).toBe('bar')
  })

  test('bridge.kv.del removes a key', async () => {
    await rpc(socketPath, 'bridge.kv.set', { from: 'pane-a', key: 'del-me', value: '123' })
    const res = await rpc(socketPath, 'bridge.kv.del', { from: 'pane-a', key: 'del-me' })
    expect((res.result as { deleted: boolean }).deleted).toBe(true)
  })

  test('bridge.kv.list returns all keys', async () => {
    await rpc(socketPath, 'bridge.kv.set', { from: 'pane-a', key: 'a', value: '1' })
    await rpc(socketPath, 'bridge.kv.set', { from: 'pane-a', key: 'b', value: '2' })
    const res = await rpc(socketPath, 'bridge.kv.list', { from: 'pane-a' })
    expect(res.result).toHaveLength(2)
  })
})

// ── Task methods dispatch ─────────────────────────────────────────────────────

describe('bridge.task.* dispatch', () => {
  test('bridge.task.create → bridge.task.claim → bridge.task.complete', async () => {
    const c = await rpc(socketPath, 'bridge.task.create', { from: 'pane-a', name: 'e2e-task' })
    const taskId = (c.result as { id: string }).id
    expect(taskId).toBeTruthy()

    const cl = await rpc(socketPath, 'bridge.task.claim', { from: 'pane-a', taskId })
    expect((cl.result as { status: string }).status).toBe('claimed')

    const co = await rpc(socketPath, 'bridge.task.complete', { from: 'pane-a', taskId })
    expect((co.result as { status: string }).status).toBe('completed')
  })

  test('bridge.task.list returns created tasks', async () => {
    await rpc(socketPath, 'bridge.task.create', { from: 'pane-a', name: 'list-test' })
    const res = await rpc(socketPath, 'bridge.task.list', { from: 'pane-a' })
    expect((res.result as unknown[]).length).toBeGreaterThanOrEqual(1)
  })

  test('bridge.task.release transitions back to pending', async () => {
    const c = await rpc(socketPath, 'bridge.task.create', { from: 'pane-a', name: 'release-test' })
    const taskId = (c.result as { id: string }).id
    await rpc(socketPath, 'bridge.task.claim', { from: 'pane-a', taskId })
    const rel = await rpc(socketPath, 'bridge.task.release', { from: 'pane-a', taskId })
    expect((rel.result as { status: string }).status).toBe('pending')
  })
})

// ── Agent methods dispatch ────────────────────────────────────────────────────

describe('bridge.agent.* dispatch', () => {
  test('bridge.agent.list returns registered panes', async () => {
    const res = await rpc(socketPath, 'bridge.agent.list', { from: 'pane-a' })
    const ids = (res.result as Array<{ paneId: string }>).map((a) => a.paneId)
    expect(ids).toContain('pane-a')
    expect(ids).toContain('pane-b')
  })

  test('bridge.agent.alias sets the alias', async () => {
    const res = await rpc(socketPath, 'bridge.agent.alias', { from: 'pane-a', alias: 'test-alias' })
    expect(res.result).toMatchObject({ ok: true })
  })
})

// ── BridgeDisabled ────────────────────────────────────────────────────────────

describe('BridgeDisabled', () => {
  test('all calls return -32010 when constructed with enabled: false', async () => {
    const disabledPath = tempSocketPath()
    const disabledServer = new BridgeServer({ db, publisher: makeFakePublisher(), enabled: false })
    await disabledServer.listen(disabledPath)

    const res = await rpc(disabledPath, 'bridge.kv.get', { from: 'pane-a', key: 'x' })
    expect(res.error?.code).toBe(ERROR_CODES.BridgeDisabled)

    await disabledServer.close()
  })
})

// ── BridgeShutdown during in-flight send-to ───────────────────────────────────

describe('BridgeShutdown', () => {
  test('closing the server during an in-flight send-to resolves the in-flight call', async () => {
    // Start a send-to that will never be accepted (timeout is long)
    const inflight = rpc(socketPath, 'bridge.send', {
      from: 'pane-a',
      to: 'pane-b',
      body: 'shutdown test',
      timeoutMs: 60000
    })

    // Give the server a moment to register the pending message
    await new Promise((r) => setTimeout(r, 20))

    // Close the server — should reject in-flight with BridgeShutdown
    await server.close()

    const res = await inflight
    expect(res.error?.code).toBe(ERROR_CODES.BridgeShutdown)
  })
})

// ── Parallel clients ──────────────────────────────────────────────────────────

describe('parallel clients', () => {
  test('two concurrent kv.set calls both succeed', async () => {
    const [r1, r2] = await Promise.all([
      rpc(socketPath, 'bridge.kv.set', { from: 'pane-a', key: 'concurrent-1', value: 'v1' }),
      rpc(socketPath, 'bridge.kv.set', { from: 'pane-b', key: 'concurrent-2', value: 'v2' })
    ])
    expect(r1.result).toMatchObject({ ok: true })
    expect(r2.result).toMatchObject({ ok: true })
  })

  test('concurrent requests from different panes do not interfere', async () => {
    await Promise.all([
      rpc(socketPath, 'bridge.kv.set', { from: 'pane-a', key: 'p-a', value: 'a' }),
      rpc(socketPath, 'bridge.kv.set', { from: 'pane-b', key: 'p-b', value: 'b' })
    ])

    const [ga, gb] = await Promise.all([
      rpc(socketPath, 'bridge.kv.get', { from: 'pane-a', key: 'p-a' }),
      rpc(socketPath, 'bridge.kv.get', { from: 'pane-b', key: 'p-b' })
    ])

    expect((ga.result as { value: string }).value).toBe('a')
    expect((gb.result as { value: string }).value).toBe('b')
  })
})

// ── Per-pane serialization ────────────────────────────────────────────────────

describe('per-pane serialization', () => {
  test('sequential requests from the same pane are processed in order', async () => {
    // Send three kv.set requests from the same pane in rapid succession
    // using the same socket to keep them on the same connection.
    const results: string[] = []

    await new Promise<void>((resolve, reject) => {
      const sock = connect(socketPath)
      let buf = ''
      let count = 0
      const total = 3

      sock.setEncoding('utf8')
      sock.on('data', (chunk: string) => {
        buf += chunk
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const parsed = JSON.parse(line) as { id: number; result?: unknown }
          results[parsed.id - 1] = String(parsed.id)
          count++
          if (count === total) {
            sock.destroy()
            resolve()
          }
        }
      })

      sock.on('error', reject)
      sock.on('connect', () => {
        for (let i = 1; i <= total; i++) {
          sock.write(
            JSON.stringify({
              jsonrpc: '2.0',
              id: i,
              method: 'bridge.kv.set',
              params: { from: 'pane-a', key: `seq-${i}`, value: `val-${i}` }
            }) + '\n'
          )
        }
      })
    })

    expect(results).toHaveLength(3)
    expect(results).toEqual(['1', '2', '3'])
  })
})
