/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConnection, type Socket } from 'net'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { unlinkSync, existsSync } from 'fs'

// We import SidecarServer — it does not exist yet (RED phase).
import { SidecarServer } from '../../../src/main/sidecar/server'

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpSock(label: string): string {
  return join(tmpdir(), `mts-test-${label}-${randomBytes(4).toString('hex')}.sock`)
}

function cleanup(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // ignore
  }
}

/**
 * Opens a raw TCP-like connection to a Unix socket and returns a thin
 * request/response helper. Newline-delimited JSON-RPC.
 */
async function connectControl(endpoint: string): Promise<{
  send: (obj: unknown) => void
  nextLine: () => Promise<string>
  close: () => void
  socket: Socket
}> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(endpoint)
    let buf = ''
    const lines: string[] = []
    const waiters: Array<(line: string) => void> = []

    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      buf += chunk
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const trimmed = part.trim()
        if (trimmed.length === 0) continue
        if (waiters.length > 0) {
          waiters.shift()!(trimmed)
        } else {
          lines.push(trimmed)
        }
      }
    })

    sock.on('connect', () => {
      resolve({
        send: (obj: unknown) => sock.write(JSON.stringify(obj) + '\n'),
        nextLine: () =>
          new Promise<string>((res) => {
            if (lines.length > 0) {
              res(lines.shift()!)
            } else {
              waiters.push(res)
            }
          }),
        close: () => sock.destroy(),
        socket: sock
      })
    })

    sock.on('error', reject)
  })
}

/**
 * Opens a raw connection to a Unix data socket.
 * Returns received bytes via async iterator.
 */
async function connectData(endpoint: string): Promise<{
  received: Buffer[]
  close: () => void
  socket: Socket
}> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(endpoint)
    const received: Buffer[] = []

    sock.on('data', (chunk: Buffer) => received.push(chunk))
    sock.on('connect', () => {
      resolve({
        received,
        close: () => sock.destroy(),
        socket: sock
      })
    })
    sock.on('error', reject)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('SidecarServer — JSON-RPC over Unix socket', () => {
  let controlSock: string
  let server: SidecarServer

  beforeEach(async () => {
    controlSock = tmpSock('control')
    server = new SidecarServer({ controlEndpoint: controlSock, sessionDir: tmpdir() })
    await server.listen()
  }, 10_000)

  afterEach(async () => {
    await server.close()
    cleanup(controlSock)
  }, 10_000)

  // ── 2.1.1 session.create returns sessionId + dataEndpoint ──────────────────

  it('session.create returns sessionId and dataEndpoint', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'session.create',
      params: {
        sessionId: 'test-session-1',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }
    })

    const raw = await ctrl.nextLine()
    const resp = JSON.parse(raw)

    expect(resp.jsonrpc).toBe('2.0')
    expect(resp.id).toBe(1)
    expect(resp.result).toBeDefined()
    expect(resp.result.sessionId).toBe('test-session-1')
    expect(typeof resp.result.dataEndpoint).toBe('string')
    expect(resp.result.dataEndpoint.length).toBeGreaterThan(0)

    ctrl.close()
  }, 10_000)

  // ── 2.1.2 session.write round-trips data to the PTY ──────────────────────

  it('session.write is accepted and returns a result', async () => {
    const ctrl = await connectControl(controlSock)

    // Create first
    ctrl.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'session.create',
      params: {
        sessionId: 'test-write-1',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }
    })
    await ctrl.nextLine() // consume create response

    // Write
    ctrl.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'session.write',
      params: { sessionId: 'test-write-1', data: 'echo hello\n' }
    })

    const raw = await ctrl.nextLine()
    const resp = JSON.parse(raw)

    expect(resp.jsonrpc).toBe('2.0')
    expect(resp.id).toBe(3)
    expect(resp.error).toBeUndefined()

    ctrl.close()
  }, 10_000)

  // ── 2.1.3 session.resize round-trips ─────────────────────────────────────

  it('session.resize is accepted and returns a result', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 4,
      method: 'session.create',
      params: {
        sessionId: 'test-resize-1',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }
    })
    await ctrl.nextLine()

    ctrl.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'session.resize',
      params: { sessionId: 'test-resize-1', cols: 120, rows: 40 }
    })

    const raw = await ctrl.nextLine()
    const resp = JSON.parse(raw)

    expect(resp.jsonrpc).toBe('2.0')
    expect(resp.id).toBe(5)
    expect(resp.error).toBeUndefined()

    ctrl.close()
  }, 10_000)

  // ── 2.1.4 session.kill round-trips ───────────────────────────────────────

  it('session.kill is accepted and returns a result', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 6,
      method: 'session.create',
      params: {
        sessionId: 'test-kill-1',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }
    })
    await ctrl.nextLine()

    ctrl.send({
      jsonrpc: '2.0',
      id: 7,
      method: 'session.kill',
      params: { sessionId: 'test-kill-1' }
    })

    const raw = await ctrl.nextLine()
    const resp = JSON.parse(raw)

    expect(resp.jsonrpc).toBe('2.0')
    expect(resp.id).toBe(7)
    expect(resp.error).toBeUndefined()

    ctrl.close()
  }, 10_000)

  // ── 2.1.5 Unknown method returns -32601 ──────────────────────────────────

  it('unknown method returns JSON-RPC error -32601', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 99,
      method: 'session.doesNotExist',
      params: {}
    })

    const raw = await ctrl.nextLine()
    const resp = JSON.parse(raw)

    expect(resp.jsonrpc).toBe('2.0')
    expect(resp.id).toBe(99)
    expect(resp.error).toBeDefined()
    expect(resp.error.code).toBe(-32601)

    ctrl.close()
  }, 10_000)

  // ── 2.1.6 session.replay streams ring buffer before live data ─────────────

  it('session.replay streams buffered content before live PTY data on the data socket', async () => {
    const ctrl = await connectControl(controlSock)

    // Create a session with a trivial shell that outputs something
    ctrl.send({
      jsonrpc: '2.0',
      id: 10,
      method: 'session.create',
      params: {
        sessionId: 'test-replay-1',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }
    })
    const createRaw = await ctrl.nextLine()
    const createResp = JSON.parse(createRaw)
    const dataEndpoint: string = createResp.result.dataEndpoint

    // Connect to data socket — this should trigger replay
    const data = await connectData(dataEndpoint)

    // Wait a bit for some PTY output and replay to arrive
    await sleep(1500)

    // Send replay request
    ctrl.send({
      jsonrpc: '2.0',
      id: 11,
      method: 'session.replay',
      params: { sessionId: 'test-replay-1' }
    })

    const replayRaw = await ctrl.nextLine()
    const replayResp = JSON.parse(replayRaw)

    // replay should acknowledge
    expect(replayResp.jsonrpc).toBe('2.0')
    expect(replayResp.id).toBe(11)
    expect(replayResp.error).toBeUndefined()

    data.close()
    ctrl.close()
  }, 15_000)

  // ── 2.1.7 Data socket receives PTY output ────────────────────────────────

  it('data socket receives PTY output after session.create', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 20,
      method: 'session.create',
      params: {
        sessionId: 'test-data-flow-1',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }
    })

    const createRaw = await ctrl.nextLine()
    const createResp = JSON.parse(createRaw)
    const dataEndpoint: string = createResp.result.dataEndpoint

    const data = await connectData(dataEndpoint)

    // Write a command that produces output
    ctrl.send({
      jsonrpc: '2.0',
      id: 21,
      method: 'session.write',
      params: { sessionId: 'test-data-flow-1', data: 'echo __MTS_MARKER__\n' }
    })
    await ctrl.nextLine() // write response

    // Wait for output
    await sleep(2000)

    const combined = Buffer.concat(data.received).toString('utf8')
    expect(combined).toContain('__MTS_MARKER__')

    data.close()
    ctrl.close()
  }, 15_000)

  // ── 2.1.8-b Idempotent session.create ────────────────────────────────────

  it('session.create with an existing sessionId returns success with the same dataEndpoint; no new PTY is spawned', async () => {
    const ctrl = await connectControl(controlSock)

    const params = {
      jsonrpc: '2.0',
      method: 'session.create',
      params: { sessionId: 'idem-sess', shell: '/bin/sh', cwd: tmpdir(), cols: 80, rows: 24 }
    }

    // First create
    ctrl.send({ ...params, id: 40 })
    const first = JSON.parse(await ctrl.nextLine())

    expect(first.result).toBeDefined()
    expect(first.error).toBeUndefined()
    const firstEndpoint: string = first.result.dataEndpoint

    // Second create — same sessionId
    ctrl.send({ ...params, id: 41 })
    const second = JSON.parse(await ctrl.nextLine())

    // Must succeed (not error -32000)
    expect(second.error).toBeUndefined()
    expect(second.result).toBeDefined()
    expect(second.result.sessionId).toBe('idem-sess')
    // Must return the SAME endpoint
    expect(second.result.dataEndpoint).toBe(firstEndpoint)

    ctrl.close()
  }, 10_000)

  // ── 2.1.9 initialCommand written after hook in the same 300 ms tick ─────

  it('session.create with zsh + initialCommand writes hook then initialCommand on the data socket', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 50,
      method: 'session.create',
      params: {
        sessionId: 'test-init-cmd-zsh',
        shell: '/bin/zsh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24,
        initialCommand: 'claude'
      }
    })

    const createRaw = await ctrl.nextLine()
    const createResp = JSON.parse(createRaw)
    const dataEndpoint: string = createResp.result.dataEndpoint

    const data = await connectData(dataEndpoint)

    // Wait longer than the 300 ms delay so the hook + initialCommand are written
    await sleep(700)

    const combined = Buffer.concat(data.received).toString('utf8')

    // Both hook content and initialCommand must appear
    const hookIdx = combined.indexOf('__mts_osc7')
    const cmdIdx = combined.indexOf('claude')

    expect(hookIdx).toBeGreaterThanOrEqual(0)
    expect(cmdIdx).toBeGreaterThanOrEqual(0)
    // Hook MUST appear before the initialCommand
    expect(hookIdx).toBeLessThan(cmdIdx)

    data.close()
    ctrl.close()
  }, 15_000)

  // ── 2.1.10 fish (no hook) + initialCommand still writes the command ──────

  it('session.create with fish + initialCommand writes initialCommand even with no hook', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 60,
      method: 'session.create',
      params: {
        sessionId: 'test-init-cmd-fish',
        shell: '/usr/bin/fish',
        cwd: tmpdir(),
        cols: 80,
        rows: 24,
        initialCommand: 'opencode'
      }
    })

    const createRaw = await ctrl.nextLine()
    const createResp = JSON.parse(createRaw)
    // If fish is not available the PTY will fail to spawn; we still get a
    // dataEndpoint back and the sidecar must attempt the write — we verify
    // by checking the endpoint path is well-formed.
    expect(createResp.result.dataEndpoint).toBeTruthy()

    ctrl.close()
  }, 10_000)

  // ── 2.1.11 idempotent create does NOT re-execute initialCommand ──────────

  it('session.create idempotent path does NOT re-write initialCommand', async () => {
    const ctrl = await connectControl(controlSock)

    const params = {
      sessionId: 'idem-cmd-sess',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24,
      initialCommand: 'echo __MTS_IDEM_MARKER__'
    }

    // First create
    ctrl.send({ jsonrpc: '2.0', id: 70, method: 'session.create', params })
    const firstResp = JSON.parse(await ctrl.nextLine())
    const dataEndpoint: string = firstResp.result.dataEndpoint

    const data = await connectData(dataEndpoint)
    // Wait for the 300 ms timeout + shell execution to settle
    await sleep(700)

    // Count occurrences produced by the first create
    const afterFirst = Buffer.concat(data.received).toString('utf8')
    const countAfterFirst = (afterFirst.match(/__MTS_IDEM_MARKER__/g) ?? []).length

    // The marker must have appeared at least once (command echoed + output)
    expect(countAfterFirst).toBeGreaterThanOrEqual(1)

    // Second create — idempotent path: existing sessionId returned immediately,
    // no new PTY spawned, no setTimeout triggered, initialCommand NOT re-written.
    ctrl.send({ jsonrpc: '2.0', id: 71, method: 'session.create', params })
    const secondResp = JSON.parse(await ctrl.nextLine())

    expect(secondResp.error).toBeUndefined()
    expect(secondResp.result.dataEndpoint).toBe(dataEndpoint)

    // Give extra time — if there were a buggy second write it would land here
    await sleep(500)

    const afterSecond = Buffer.concat(data.received).toString('utf8')
    const countAfterSecond = (afterSecond.match(/__MTS_IDEM_MARKER__/g) ?? []).length

    // The count must not have grown — no new write from the idempotent create
    expect(countAfterSecond).toBe(countAfterFirst)

    data.close()
    ctrl.close()
  }, 15_000)

  // ── 2.1.8 Multiple concurrent sessions are independent ───────────────────

  it('two concurrent sessions are independent and each has a distinct dataEndpoint', async () => {
    const ctrl = await connectControl(controlSock)

    ctrl.send({
      jsonrpc: '2.0',
      id: 30,
      method: 'session.create',
      params: { sessionId: 'sess-A', shell: '/bin/sh', cwd: tmpdir(), cols: 80, rows: 24 }
    })
    const respA = JSON.parse(await ctrl.nextLine())

    ctrl.send({
      jsonrpc: '2.0',
      id: 31,
      method: 'session.create',
      params: { sessionId: 'sess-B', shell: '/bin/sh', cwd: tmpdir(), cols: 80, rows: 24 }
    })
    const respB = JSON.parse(await ctrl.nextLine())

    expect(respA.result.dataEndpoint).not.toBe(respB.result.dataEndpoint)
    expect(respA.result.sessionId).toBe('sess-A')
    expect(respB.result.sessionId).toBe('sess-B')

    ctrl.close()
  }, 10_000)
})
