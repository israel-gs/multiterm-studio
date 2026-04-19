/** @vitest-environment node */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { homedir } from 'os'
import { join } from 'path'

// Helpers to temporarily override process.platform without vi.stubProperty
// (not available in vitest 3.2.4).
let originalPlatform: PropertyDescriptor | undefined

function stubPlatform(value: string): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value, writable: true, configurable: true })
}

function restorePlatform(): void {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform)
    originalPlatform = undefined
  }
}

afterEach(() => {
  restorePlatform()
  vi.restoreAllMocks()
})

// Import AFTER the helper definitions — the module is re-evaluated per test
// file in vitest, so the stubs apply to every call within this file.
import {
  makeEndpointPath,
  sessionDataEndpointPath,
  makeRequest,
  makeResponse,
  makeError,
  makeNotification,
  SIDECAR_CONTROL_ENDPOINT,
  SIDECAR_PID_PATH,
  DEFAULT_SCROLLBACK_BYTES
} from '../../../src/main/sidecar/protocol'

// ── Endpoint paths ──────────────────────────────────────────────────────────

describe('makeEndpointPath — darwin/linux', () => {
  beforeEach(() => stubPlatform('darwin'))
  afterEach(() => restorePlatform())

  test('returns a path ending with <name>.sock', () => {
    const p = makeEndpointPath('sidecar')
    expect(p).toMatch(/\.sock$/)
  })

  test('includes the name in the filename', () => {
    expect(makeEndpointPath('sidecar')).toContain('sidecar.sock')
  })

  test('is placed under ~/.multiterm-studio/', () => {
    const expected = join(homedir(), '.multiterm-studio', 'sidecar.sock')
    expect(makeEndpointPath('sidecar')).toBe(expected)
  })

  test('linux returns same unix socket path', () => {
    restorePlatform()
    stubPlatform('linux')
    const expected = join(homedir(), '.multiterm-studio', 'test.sock')
    expect(makeEndpointPath('test')).toBe(expected)
  })
})

describe('makeEndpointPath — windows (forward compat)', () => {
  beforeEach(() => stubPlatform('win32'))
  afterEach(() => restorePlatform())

  test('returns a named pipe path on win32', () => {
    const p = makeEndpointPath('sidecar')
    expect(p).toMatch(/^\\\\\.\\pipe\\/)
  })

  test('win32 pipe includes the name', () => {
    expect(makeEndpointPath('sidecar')).toContain('sidecar')
  })
})

describe('sessionDataEndpointPath', () => {
  beforeEach(() => stubPlatform('darwin'))
  afterEach(() => restorePlatform())

  test('unix: includes sessionId in path', () => {
    const p = sessionDataEndpointPath('abc-123')
    expect(p).toContain('abc-123')
  })

  test('unix: placed under ~/.multiterm-studio/pty-sessions/', () => {
    const expected = join(homedir(), '.multiterm-studio', 'pty-sessions', 'abc-123.sock')
    expect(sessionDataEndpointPath('abc-123')).toBe(expected)
  })
})

// ── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  test('SIDECAR_CONTROL_ENDPOINT is a non-empty string', () => {
    expect(typeof SIDECAR_CONTROL_ENDPOINT).toBe('string')
    expect(SIDECAR_CONTROL_ENDPOINT.length).toBeGreaterThan(0)
  })

  test('SIDECAR_PID_PATH is a non-empty string', () => {
    expect(typeof SIDECAR_PID_PATH).toBe('string')
    expect(SIDECAR_PID_PATH.length).toBeGreaterThan(0)
  })

  test('SIDECAR_PID_PATH ends with sidecar.pid', () => {
    expect(SIDECAR_PID_PATH).toMatch(/sidecar\.pid$/)
  })

  test('DEFAULT_SCROLLBACK_BYTES is 8 MB', () => {
    expect(DEFAULT_SCROLLBACK_BYTES).toBe(8 * 1024 * 1024)
  })
})

// ── JSON-RPC codecs ─────────────────────────────────────────────────────────

describe('makeRequest', () => {
  test('returns a newline-terminated JSON string', () => {
    const s = makeRequest(1, 'session.create', { a: 1 })
    expect(s.endsWith('\n')).toBe(true)
  })

  test('parses as valid JSON', () => {
    const s = makeRequest(1, 'session.create', { a: 1 })
    expect(() => JSON.parse(s)).not.toThrow()
  })

  test('jsonrpc field is "2.0"', () => {
    const obj = JSON.parse(makeRequest(1, 'session.create'))
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('id matches provided value', () => {
    const obj = JSON.parse(makeRequest(42, 'session.create'))
    expect(obj.id).toBe(42)
  })

  test('method matches provided value', () => {
    const obj = JSON.parse(makeRequest(1, 'session.write'))
    expect(obj.method).toBe('session.write')
  })

  test('params are embedded when provided', () => {
    const obj = JSON.parse(makeRequest(1, 'session.create', { shell: 'zsh' }))
    expect(obj.params).toEqual({ shell: 'zsh' })
  })

  test('params are absent when not provided', () => {
    const obj = JSON.parse(makeRequest(1, 'session.kill'))
    expect(obj.params).toBeUndefined()
  })

  test('round-trip: string id survives serialization', () => {
    const obj = JSON.parse(makeRequest('abc', 'session.create'))
    expect(obj.id).toBe('abc')
  })
})

describe('makeResponse', () => {
  test('returns a newline-terminated JSON string', () => {
    expect(makeResponse(1, { ok: true }).endsWith('\n')).toBe(true)
  })

  test('jsonrpc field is "2.0"', () => {
    const obj = JSON.parse(makeResponse(1, { ok: true }))
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('id matches provided value', () => {
    const obj = JSON.parse(makeResponse(7, { ok: true }))
    expect(obj.id).toBe(7)
  })

  test('result matches provided value', () => {
    const result = { sessionId: 'x', dataEndpoint: '/tmp/x.sock' }
    const obj = JSON.parse(makeResponse(1, result))
    expect(obj.result).toEqual(result)
  })

  test('no error field present', () => {
    const obj = JSON.parse(makeResponse(1, {}))
    expect(obj.error).toBeUndefined()
  })
})

describe('makeError', () => {
  test('returns a newline-terminated JSON string', () => {
    expect(makeError(1, -32601, 'Method not found').endsWith('\n')).toBe(true)
  })

  test('jsonrpc field is "2.0"', () => {
    const obj = JSON.parse(makeError(1, -32601, 'Method not found'))
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('id matches provided value', () => {
    const obj = JSON.parse(makeError(3, -32601, 'Method not found'))
    expect(obj.id).toBe(3)
  })

  test('error.code matches provided code', () => {
    const obj = JSON.parse(makeError(1, -32601, 'Method not found'))
    expect(obj.error.code).toBe(-32601)
  })

  test('error.message matches provided message', () => {
    const obj = JSON.parse(makeError(1, -32601, 'Method not found'))
    expect(obj.error.message).toBe('Method not found')
  })

  test('no result field present', () => {
    const obj = JSON.parse(makeError(1, -32601, 'Method not found'))
    expect(obj.result).toBeUndefined()
  })
})

describe('makeNotification', () => {
  test('returns a newline-terminated JSON string', () => {
    expect(makeNotification('session.cwd-changed', { cwd: '/tmp' }).endsWith('\n')).toBe(true)
  })

  test('jsonrpc field is "2.0"', () => {
    const obj = JSON.parse(makeNotification('session.cwd-changed'))
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('no id field (notifications are fire-and-forget)', () => {
    const obj = JSON.parse(makeNotification('session.cwd-changed'))
    expect(obj.id).toBeUndefined()
  })

  test('method matches provided value', () => {
    const obj = JSON.parse(makeNotification('session.cwd-changed', { cwd: '/tmp' }))
    expect(obj.method).toBe('session.cwd-changed')
  })

  test('params are embedded when provided', () => {
    const obj = JSON.parse(makeNotification('session.cwd-changed', { cwd: '/tmp' }))
    expect(obj.params).toEqual({ cwd: '/tmp' })
  })

  test('params absent when not provided', () => {
    const obj = JSON.parse(makeNotification('session.cwd-changed'))
    expect(obj.params).toBeUndefined()
  })
})
