/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

// SidecarServer is used to provide a real server for the client to connect to.
import { SidecarServer } from '../../../src/main/sidecar/server'
// SidecarClient is what we are testing — does not exist yet (RED phase).
import { SidecarClient } from '../../../src/main/sidecar/client'

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpSock(label: string): string {
  return join(tmpdir(), `mts-client-test-${label}-${randomBytes(4).toString('hex')}.sock`)
}

function cleanup(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // ignore
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('SidecarClient', () => {
  let controlSock: string
  let server: SidecarServer
  let client: SidecarClient

  beforeEach(async () => {
    controlSock = tmpSock('ctrl')
    server = new SidecarServer({ controlEndpoint: controlSock, sessionDir: tmpdir() })
    await server.listen()
    client = new SidecarClient()
    await client.connect(controlSock)
  }, 10_000)

  afterEach(async () => {
    client.disconnect()
    await server.close()
    cleanup(controlSock)
  }, 10_000)

  // ── 2.4.1 Request/response correlation by id ──────────────────────────────

  it('create() returns sessionId and dataEndpoint', async () => {
    const result = await client.create({
      sessionId: 'client-test-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    expect(result.sessionId).toBe('client-test-1')
    expect(typeof result.dataEndpoint).toBe('string')
    expect(result.dataEndpoint.length).toBeGreaterThan(0)
  }, 10_000)

  it('concurrent creates correlate responses to the correct requests', async () => {
    // Fire two creates simultaneously — responses may arrive in any order.
    // Client MUST correlate by JSON-RPC id.
    const [r1, r2] = await Promise.all([
      client.create({
        sessionId: 'corr-A',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      }),
      client.create({
        sessionId: 'corr-B',
        shell: '/bin/sh',
        cwd: tmpdir(),
        cols: 80,
        rows: 24
      })
    ])

    expect(r1.sessionId).toBe('corr-A')
    expect(r2.sessionId).toBe('corr-B')
    expect(r1.dataEndpoint).not.toBe(r2.dataEndpoint)
  }, 10_000)

  // ── 2.4.2 write / resize / kill round-trips ──────────────────────────────

  it('write() resolves without error', async () => {
    await client.create({
      sessionId: 'client-write-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    await expect(client.write('client-write-1', 'echo hi\n')).resolves.toBeUndefined()
  }, 10_000)

  it('resize() resolves without error', async () => {
    await client.create({
      sessionId: 'client-resize-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    await expect(client.resize('client-resize-1', 120, 40)).resolves.toBeUndefined()
  }, 10_000)

  it('kill() resolves without error', async () => {
    await client.create({
      sessionId: 'client-kill-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    await expect(client.kill('client-kill-1')).resolves.toBeUndefined()
  }, 10_000)

  // ── 2.4.3 Error responses propagate as rejected promises ─────────────────

  it('write() to a non-existent session rejects with an error', async () => {
    await expect(client.write('no-such-session', 'data')).rejects.toThrow()
  }, 10_000)

  it('resize() to a non-existent session rejects with an error', async () => {
    await expect(client.resize('no-such-session', 80, 24)).rejects.toThrow()
  }, 10_000)

  // ── 2.4.4 onData() — subscription to data endpoint per session ───────────

  it('onData() callback receives PTY output bytes', async () => {
    const { dataEndpoint } = await client.create({
      sessionId: 'client-data-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    const received: Buffer[] = []
    await client.onData('client-data-1', dataEndpoint, (chunk) => received.push(chunk))

    await client.write('client-data-1', 'echo __CLIENT_MARKER__\n')

    // Wait for output to arrive
    await sleep(2000)

    const combined = Buffer.concat(received).toString('utf8')
    expect(combined).toContain('__CLIENT_MARKER__')
  }, 15_000)

  // ── 2.4.4b onData() returns a promise that resolves after connect ────────

  it('onData() returns a Promise that resolves once the socket connects', async () => {
    const { dataEndpoint } = await client.create({
      sessionId: 'client-ondata-promise-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    const result = client.onData('client-ondata-promise-1', dataEndpoint, () => {})
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toBeUndefined()
  }, 10_000)

  it('calling onData() twice for the same sessionId resolves immediately without opening a second socket', async () => {
    const { dataEndpoint } = await client.create({
      sessionId: 'client-ondata-idem-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    await client.onData('client-ondata-idem-1', dataEndpoint, () => {})

    // Second call — should resolve immediately (no second socket)
    const start = Date.now()
    await client.onData('client-ondata-idem-1', dataEndpoint, () => {})
    const elapsed = Date.now() - start

    // Resolved synchronously-ish (< 50 ms) — no network round-trip
    expect(elapsed).toBeLessThan(50)
  }, 10_000)

  // ── 2.4.5 replay() resolves after buffered prelude arrives ───────────────

  it('replay() resolves after server flushes the ring buffer', async () => {
    const { dataEndpoint } = await client.create({
      sessionId: 'client-replay-1',
      shell: '/bin/sh',
      cwd: tmpdir(),
      cols: 80,
      rows: 24
    })

    // Subscribe so we can get data
    const received: Buffer[] = []
    await client.onData('client-replay-1', dataEndpoint, (chunk) => received.push(chunk))

    // Let the PTY produce some output first
    await client.write('client-replay-1', 'echo __PRE_REPLAY__\n')
    await sleep(1500)

    // replay() should resolve (server sends ring buffer to existing data clients)
    await expect(client.replay('client-replay-1')).resolves.toBeUndefined()
  }, 15_000)
})
