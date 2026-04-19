import { homedir } from 'os'
import { join } from 'path'

// ── Type definitions ─────────────────────────────────────────────────────────

export type RpcMethod =
  | 'session.create'
  | 'session.write'
  | 'session.resize'
  | 'session.kill'
  | 'session.replay'

export interface SessionCreateParams {
  sessionId: string
  shell: string
  cwd: string
  cols: number
  rows: number
  scrollbackBytes?: number
}

export interface SessionCreateResult {
  sessionId: string
  dataEndpoint: string
}

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

// ── Endpoint path helpers ─────────────────────────────────────────────────────

/**
 * Returns the socket path for a named endpoint.
 * macOS / Linux → Unix domain socket under ~/.multiterm-studio/
 * Windows       → Named pipe (forward compat; not validated in this change)
 */
export function makeEndpointPath(name: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\multiterm-${name}`
  }
  return join(homedir(), '.multiterm-studio', `${name}.sock`)
}

/**
 * Returns the per-session data socket path for a given sessionId.
 */
export function sessionDataEndpointPath(sessionId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\multiterm-session-${sessionId}`
  }
  return join(homedir(), '.multiterm-studio', 'pty-sessions', `${sessionId}.sock`)
}

// ── Constants ────────────────────────────────────────────────────────────────

export const SIDECAR_CONTROL_ENDPOINT = makeEndpointPath('sidecar')
export const SIDECAR_PID_PATH = join(homedir(), '.multiterm-studio', 'sidecar.pid')
export const DEFAULT_SCROLLBACK_BYTES = 8 * 1024 * 1024

// ── JSON-RPC 2.0 codec helpers ───────────────────────────────────────────────

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
