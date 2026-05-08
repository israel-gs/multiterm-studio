/** @vitest-environment node */
import { describe, test, expect } from 'vitest'
import {
  makeRequest,
  makeResponse,
  makeError,
  makeNotification,
  BRIDGE_CONTROL_ENDPOINT,
  ERROR_CODES,
  METHODS,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  type JsonRpcError
} from '../../../src/main/bridge/protocol'

// ── JSON-RPC codec round-trips ───────────────────────────────────────────────

describe('makeRequest', () => {
  test('is newline-terminated', () => {
    expect(makeRequest(1, 'bridge.kv.get', { key: 'x' }).endsWith('\n')).toBe(true)
  })

  test('parses as valid JSON', () => {
    expect(() => JSON.parse(makeRequest(1, 'bridge.kv.get'))).not.toThrow()
  })

  test('jsonrpc is "2.0"', () => {
    const obj = JSON.parse(makeRequest(1, 'bridge.kv.get')) as JsonRpcRequest
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('id is preserved', () => {
    expect((JSON.parse(makeRequest(42, 'bridge.kv.get')) as JsonRpcRequest).id).toBe(42)
    expect((JSON.parse(makeRequest('abc', 'bridge.kv.get')) as JsonRpcRequest).id).toBe('abc')
  })

  test('method is preserved', () => {
    const obj = JSON.parse(makeRequest(1, 'bridge.agent.list')) as JsonRpcRequest
    expect(obj.method).toBe('bridge.agent.list')
  })

  test('params are embedded when provided', () => {
    const obj = JSON.parse(
      makeRequest(1, 'bridge.kv.set', { key: 'k', value: 'v' })
    ) as JsonRpcRequest
    expect(obj.params).toEqual({ key: 'k', value: 'v' })
  })

  test('params are absent when not provided', () => {
    const obj = JSON.parse(makeRequest(1, 'bridge.agent.list')) as JsonRpcRequest
    expect(obj.params).toBeUndefined()
  })
})

describe('makeResponse', () => {
  test('is newline-terminated', () => {
    expect(makeResponse(1, { ok: true }).endsWith('\n')).toBe(true)
  })

  test('jsonrpc is "2.0"', () => {
    const obj = JSON.parse(makeResponse(1, null)) as JsonRpcResponse
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('id and result are preserved', () => {
    const result = { paneId: 'pane-abc', alias: 'reviewer' }
    const obj = JSON.parse(makeResponse(7, result)) as JsonRpcResponse
    expect(obj.id).toBe(7)
    expect(obj.result).toEqual(result)
  })

  test('no error field present', () => {
    const obj = JSON.parse(makeResponse(1, {})) as Record<string, unknown>
    expect(obj.error).toBeUndefined()
  })
})

describe('makeError', () => {
  test('is newline-terminated', () => {
    expect(makeError(1, -32020, 'PaneNotFound').endsWith('\n')).toBe(true)
  })

  test('jsonrpc is "2.0"', () => {
    const obj = JSON.parse(makeError(1, -32020, 'PaneNotFound')) as JsonRpcError
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('error.code and error.message are preserved', () => {
    const obj = JSON.parse(makeError(3, -32021, 'AliasCollision')) as JsonRpcError
    expect(obj.id).toBe(3)
    expect(obj.error.code).toBe(-32021)
    expect(obj.error.message).toBe('AliasCollision')
  })

  test('no result field present', () => {
    const obj = JSON.parse(makeError(1, -32020, 'x')) as Record<string, unknown>
    expect(obj.result).toBeUndefined()
  })
})

describe('makeNotification', () => {
  test('is newline-terminated', () => {
    expect(makeNotification('bridge.pending', { paneId: 'pane-abc' }).endsWith('\n')).toBe(true)
  })

  test('jsonrpc is "2.0"', () => {
    const obj = JSON.parse(makeNotification('bridge.pending')) as JsonRpcNotification
    expect(obj.jsonrpc).toBe('2.0')
  })

  test('no id field (fire-and-forget)', () => {
    const obj = JSON.parse(makeNotification('bridge.pending')) as Record<string, unknown>
    expect(obj.id).toBeUndefined()
  })

  test('method and params are preserved', () => {
    const obj = JSON.parse(makeNotification('bridge.pending', { count: 2 })) as JsonRpcNotification
    expect(obj.method).toBe('bridge.pending')
    expect(obj.params).toEqual({ count: 2 })
  })

  test('params are absent when not provided', () => {
    const obj = JSON.parse(makeNotification('bridge.pending')) as Record<string, unknown>
    expect(obj.params).toBeUndefined()
  })
})

// ── BRIDGE_CONTROL_ENDPOINT ──────────────────────────────────────────────────

describe('BRIDGE_CONTROL_ENDPOINT', () => {
  test('is a non-empty string', () => {
    expect(typeof BRIDGE_CONTROL_ENDPOINT).toBe('string')
    expect(BRIDGE_CONTROL_ENDPOINT.length).toBeGreaterThan(0)
  })

  test('contains "bridge" in the path', () => {
    expect(BRIDGE_CONTROL_ENDPOINT).toContain('bridge')
  })
})

// ── Error code constants ─────────────────────────────────────────────────────

describe('ERROR_CODES', () => {
  const table: Array<[keyof typeof ERROR_CODES, number]> = [
    ['GenericBridgeError', -32000],
    ['NotOwner', -32001],
    ['BridgeDisabled', -32010],
    ['BridgeShutdown', -32011],
    ['PaneNotFound', -32020],
    ['AliasCollision', -32021],
    ['TaskNotFound', -32030],
    ['TaskStateInvalid', -32031],
    ['DeclinedByUser', -32040],
    ['Timeout', -32041],
    ['KVKeyInvalid', -32050]
  ]

  test.each(table)('ERROR_CODES.%s === %i', (name, code) => {
    expect(ERROR_CODES[name]).toBe(code)
  })

  test('no two names share a code', () => {
    const codes = Object.values(ERROR_CODES) as number[]
    const unique = new Set(codes)
    expect(codes.length).toBe(unique.size)
  })
})

// ── Method name constants ────────────────────────────────────────────────────

describe('METHODS', () => {
  // Every method defined in the pane-bridge namespace table must exist
  const required = [
    'bridge.send',
    'bridge.notify',
    'bridge.task.create',
    'bridge.task.claim',
    'bridge.task.complete',
    'bridge.task.fail',
    'bridge.task.release',
    'bridge.task.list',
    'bridge.kv.set',
    'bridge.kv.get',
    'bridge.kv.del',
    'bridge.kv.list',
    'bridge.agent.list',
    'bridge.agent.alias'
  ]

  test.each(required)('METHODS includes "%s"', (method) => {
    const values = Object.values(METHODS) as string[]
    expect(values).toContain(method)
  })

  test('all values are strings under the bridge.* prefix', () => {
    for (const v of Object.values(METHODS)) {
      expect(typeof v).toBe('string')
      expect((v as string).startsWith('bridge.')).toBe(true)
    }
  })
})
