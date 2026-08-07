import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest'
import { connect, type Socket } from 'net'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Redirect the socket/discovery/token files away from ~/.multiterm-studio so
// the suite never disturbs a running app. Must be set before the import below.
const STATE_DIR = mkdtempSync(join(tmpdir(), 'mts-rpc-test-'))
process.env.MULTITERM_STATE_DIR = STATE_DIR

/**
 * rpcServer exposes pane.runCommand / pane.sendText, i.e. arbitrary command
 * execution in the user's terminals. These tests pin the two controls that
 * stand between that surface and any other process on the machine:
 * owner-only socket permissions and a per-run token.
 */

// ── electron mock ─────────────────────────────────────────────────────────────

const mockSend = vi.fn()
const mockWin = { webContents: { send: mockSend } }

vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), once: vi.fn(), emit: vi.fn(), removeAllListeners: vi.fn() },
  Notification: class {
    show(): void {
      /* notifications are not exercised here */
    }
  }
}))

// ── ptyManager mock (no real PTYs in this test) ───────────────────────────────

const mockWriteToPty = vi.fn().mockReturnValue(true)

vi.mock('../../src/main/ptyManager', () => ({
  writeToPty: (...args: unknown[]) => mockWriteToPty(...args),
  listPtySessions: () => ['session-a']
}))

// ─────────────────────────────────────────────────────────────────────────────

let socketPath: string
let cleanup: () => void
let token: string

/** Sends one JSON-RPC line and resolves with the parsed reply (or null on close). */
function request(payload: unknown): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const sock: Socket = connect(socketPath, () => {
      sock.write(JSON.stringify(payload) + '\n')
    })
    let buf = ''
    sock.on('data', (chunk) => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl !== -1) {
        sock.destroy()
        resolve(JSON.parse(buf.slice(0, nl)))
      }
    })
    sock.on('close', () => resolve(buf.trim() ? JSON.parse(buf.trim()) : null))
    sock.on('error', () => resolve(null))
  })
}

beforeAll(async () => {
  const { startRpcServer } = await import('../../src/main/rpcServer')
  const started = await startRpcServer(mockWin as never)
  socketPath = started.socketPath
  cleanup = started.cleanup
  token = readFileSync(join(STATE_DIR, 'socket-token'), 'utf-8').trim()
})

afterAll(() => {
  cleanup()
  delete process.env.MULTITERM_STATE_DIR
  rmSync(STATE_DIR, { recursive: true, force: true })
})

describe('rpcServer — socket exposure', () => {
  test('the socket lives in the private state dir, not a shared temp path', () => {
    expect(socketPath.startsWith(STATE_DIR)).toBe(true)
  })

  test('the socket is not readable or writable by group or other', () => {
    const mode = statSync(socketPath).mode & 0o777
    expect(mode & 0o077).toBe(0)
  })

  test('the token file is not readable by group or other', () => {
    const mode = statSync(join(STATE_DIR, 'socket-token')).mode & 0o777
    expect(mode & 0o077).toBe(0)
  })
})

describe('rpcServer — authentication', () => {
  test('rejects a command-executing method when no token is supplied', async () => {
    const reply = await request({
      jsonrpc: '2.0',
      id: 1,
      method: 'pane.runCommand',
      params: { session_id: 'session-a', command: 'echo pwned' }
    })

    expect(reply?.error).toMatchObject({ code: -32001 })
    expect(mockWriteToPty).not.toHaveBeenCalled()
  })

  test('rejects a wrong token', async () => {
    const reply = await request({
      jsonrpc: '2.0',
      id: 2,
      method: 'pane.runCommand',
      token: 'not-the-token-but-same-ish-length-000000',
      params: { session_id: 'session-a', command: 'echo pwned' }
    })

    expect(reply?.error).toMatchObject({ code: -32001 })
    expect(mockWriteToPty).not.toHaveBeenCalled()
  })

  test('rejects an unauthenticated ping', async () => {
    const reply = await request({ jsonrpc: '2.0', id: 3, method: 'ping' })
    expect(reply?.error).toMatchObject({ code: -32001 })
  })

  test('accepts a request carrying the token', async () => {
    const reply = await request({ jsonrpc: '2.0', id: 4, method: 'ping', token })
    expect(reply?.result).toEqual({ pong: true })
  })

  test('runs the command once authenticated', async () => {
    const reply = await request({
      jsonrpc: '2.0',
      id: 5,
      method: 'pane.runCommand',
      token,
      params: { session_id: 'session-a', command: 'echo hi' }
    })

    expect(reply?.result).toEqual({ ok: true })
    expect(mockWriteToPty).toHaveBeenCalledWith('session-a', 'echo hi\r')
  })
})
