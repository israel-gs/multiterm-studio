// Re-export the shared endpoint helper from the sidecar protocol so that the
// bridge module does not duplicate that logic.
import { makeEndpointPath } from '../sidecar/protocol'

export { makeEndpointPath }

// ── Bridge control endpoint ───────────────────────────────────────────────────

/**
 * Stable Unix socket / Named Pipe for the bridge daemon.
 * The CLI connects here on every invocation; the path must never include
 * a pid or ephemeral component — the CLI cannot discover the pid before connecting.
 */
export const BRIDGE_CONTROL_ENDPOINT = makeEndpointPath('bridge')

// ── JSON-RPC 2.0 types ────────────────────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result: unknown
}

export interface JsonRpcError {
  jsonrpc: '2.0'
  id: string | number
  error: { code: number; message: string }
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/**
 * Union of all bridge method name string literals, derived from METHODS values.
 * Used to type-narrow dispatch switch statements.
 */
export type BridgeMethod = (typeof METHODS)[keyof typeof METHODS]

// ── Method name constants ─────────────────────────────────────────────────────

/**
 * Canonical method name table for the bridge JSON-RPC namespace.
 * Centralised here so callers never hardcode string literals.
 */
export const METHODS = {
  Send: 'bridge.send',
  Notify: 'bridge.notify',
  TaskCreate: 'bridge.task.create',
  TaskClaim: 'bridge.task.claim',
  TaskComplete: 'bridge.task.complete',
  TaskFail: 'bridge.task.fail',
  TaskRelease: 'bridge.task.release',
  TaskList: 'bridge.task.list',
  KvSet: 'bridge.kv.set',
  KvGet: 'bridge.kv.get',
  KvDel: 'bridge.kv.del',
  KvList: 'bridge.kv.list',
  AgentList: 'bridge.agent.list',
  AgentAlias: 'bridge.agent.alias'
} as const

// ── Error code constants ──────────────────────────────────────────────────────

/**
 * Stable bridge-specific JSON-RPC error codes in the -32000 to -32099 range.
 * These must never be renumbered — CLI exit-code mapping depends on them.
 */
export const ERROR_CODES = {
  GenericBridgeError: -32000,
  /** The claiming pane is not the task owner. */
  NotOwner: -32001,
  BridgeDisabled: -32010,
  BridgeShutdown: -32011,
  PaneNotFound: -32020,
  AliasCollision: -32021,
  TaskNotFound: -32030,
  TaskStateInvalid: -32031,
  DeclinedByUser: -32040,
  Timeout: -32041,
  KVKeyInvalid: -32050
} as const

// ── JSON-RPC 2.0 codec helpers ────────────────────────────────────────────────

function serialize(obj: unknown): string {
  return JSON.stringify(obj) + '\n'
}

export function makeRequest(id: string | number, method: string, params?: unknown): string {
  const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method }
  if (params !== undefined) msg.params = params
  return serialize(msg)
}

export function makeResponse(id: string | number, result: unknown): string {
  const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result }
  return serialize(msg)
}

export function makeError(id: string | number, code: number, message: string): string {
  const msg: JsonRpcError = { jsonrpc: '2.0', id, error: { code, message } }
  return serialize(msg)
}

export function makeNotification(method: string, params?: unknown): string {
  const msg: JsonRpcNotification = { jsonrpc: '2.0', method }
  if (params !== undefined) msg.params = params
  return serialize(msg)
}
