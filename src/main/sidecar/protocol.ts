import { homedir } from 'os'
import { join } from 'path'

// ── Type definitions ─────────────────────────────────────────────────────────

export interface SessionCreateParams {
  sessionId: string
  shell: string
  cwd: string
  cols: number
  rows: number
  scrollbackBytes?: number
  initialCommand?: string
}

export interface SessionCreateResult {
  sessionId: string
  dataEndpoint: string
}

/** Payload of the `session.exit` notification broadcast when a PTY dies. */
export interface SessionExitParams {
  sessionId: string
  exitCode: number
  signal?: number
}

/** Method name of the server → client notification sent when a PTY exits. */
export const SESSION_EXIT_METHOD = 'session.exit'

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
