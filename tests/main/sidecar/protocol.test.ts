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
  SIDECAR_CONTROL_ENDPOINT,
  SIDECAR_PID_PATH
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
})
