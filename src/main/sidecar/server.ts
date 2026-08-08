import { createServer, type Server as NetServer, type Socket } from 'net'
import { execFile } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import * as pty from 'node-pty'
import { RingBuffer } from './ring-buffer'
import { osc7ShellHook } from './shell-init'
import { ensureSecureDir, secureSocketFile } from '../socketSecurity'
import { SCROLLBACK_DEFAULT_BYTES } from '../../shared/scrollback'
import {
  SESSION_EXIT_METHOD,
  sessionDataEndpointPath,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionExitParams,
  type JsonRpcRequest
} from './protocol'

/**
 * Hard cap on a single control-socket line. A peer that never sends a newline
 * would otherwise grow the read buffer without bound.
 */
const MAX_CONTROL_LINE_BYTES = 1024 * 1024

// ── Internal session record ───────────────────────────────────────────────────

interface Session {
  sessionId: string
  pty: pty.IPty
  buffer: RingBuffer
  dataEndpoint: string
  dataServer: NetServer
  dataClients: Set<Socket>
  /** Set once the PTY process has exited. The record is kept so scrollback
   *  replay keeps working until the client explicitly calls session.kill. */
  exited: boolean
}

// ── SidecarServer options ─────────────────────────────────────────────────────

export interface SidecarServerOptions {
  /** Path for the JSON-RPC control socket. */
  controlEndpoint: string
  /**
   * Directory under which per-session data sockets will be created.
   * Defaults to the directory derived from sessionDataEndpointPath.
   * Overridable for tests (use os.tmpdir()).
   */
  sessionDir?: string
}

// ── SidecarServer ─────────────────────────────────────────────────────────────

/**
 * Manages a JSON-RPC 2.0 control socket and per-session data sockets backed by
 * node-pty instances. Each session owns a RingBuffer for scrollback replay.
 */
export class SidecarServer {
  private readonly controlEndpoint: string
  private readonly sessionDir: string | undefined
  private controlServer: NetServer | null = null
  private readonly sessions = new Map<string, Session>()
  /** Live control connections — `session.exit` notifications go to all of them. */
  private readonly controlClients = new Set<Socket>()

  constructor(opts: SidecarServerOptions) {
    this.controlEndpoint = opts.controlEndpoint
    this.sessionDir = opts.sessionDir
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async listen(): Promise<void> {
    removeSocket(this.controlEndpoint)
    ensureSecureDir(this.controlEndpoint)

    return new Promise<void>((resolve, reject) => {
      const srv = createServer((socket) => this.handleControlConnection(socket))
      this.controlServer = srv

      srv.on('error', reject)
      srv.listen(this.controlEndpoint, () => {
        // Writing to this socket means writing to a PTY — owner only.
        secureSocketFile(this.controlEndpoint)
        resolve()
      })
    })
  }

  async close(): Promise<void> {
    // Close all sessions
    for (const session of this.sessions.values()) {
      this.destroySession(session)
    }
    this.sessions.clear()

    // Drop the control connections first. net.Server.close() stops accepting
    // new peers but only completes once the existing ones have ended, so a
    // still-connected client would keep shutdown waiting forever.
    for (const client of this.controlClients) {
      try {
        client.destroy()
      } catch {
        // ignore
      }
    }
    this.controlClients.clear()

    // Close control server
    if (this.controlServer) {
      await closeServer(this.controlServer)
      this.controlServer = null
    }

    removeSocket(this.controlEndpoint)
  }

  // ── Control connection handling ─────────────────────────────────────────────

  private handleControlConnection(socket: Socket): void {
    let buf = ''
    socket.setEncoding('utf8')
    this.controlClients.add(socket)

    socket.on('data', (chunk: string) => {
      buf += chunk

      if (buf.length > MAX_CONTROL_LINE_BYTES) {
        // Unterminated garbage — drop the peer instead of growing forever.
        buf = ''
        socket.destroy()
        return
      }

      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        this.handleControlMessage(socket, trimmed)
      }
    })

    socket.on('error', () => {
      // Connection dropped — silently ignore
    })

    socket.on('close', () => {
      this.controlClients.delete(socket)
    })
  }

  /** Sends a JSON-RPC notification to every connected control client. */
  private broadcastNotification(method: string, params: unknown): void {
    for (const client of this.controlClients) {
      sendJson(client, { jsonrpc: '2.0', method, params })
    }
  }

  private handleControlMessage(socket: Socket, raw: string): void {
    let req: JsonRpcRequest

    try {
      req = JSON.parse(raw) as JsonRpcRequest
    } catch {
      sendJson(socket, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      })
      return
    }

    const { id, method, params } = req

    switch (method) {
      case 'session.create':
        this.handleCreate(socket, id, params as SessionCreateParams)
        break
      case 'session.write':
        this.handleWrite(socket, id, params as { sessionId: string; data: string })
        break
      case 'session.resize':
        this.handleResize(socket, id, params as { sessionId: string; cols: number; rows: number })
        break
      case 'session.kill':
        this.handleKill(socket, id, params as { sessionId: string })
        break
      case 'session.replay':
        this.handleReplay(socket, id, params as { sessionId: string })
        break
      case 'session.foreground':
        this.handleForeground(socket, id, params as { sessionId: string })
        break
      default:
        sendJson(socket, {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' }
        })
    }
  }

  // ── RPC handlers ────────────────────────────────────────────────────────────

  private handleCreate(socket: Socket, id: string | number, params: SessionCreateParams): void {
    const { sessionId, shell, cwd, cols, rows, scrollbackBytes, initialCommand } = params

    const existing = this.sessions.get(sessionId)
    if (existing && !existing.exited) {
      // Idempotent: return the existing session's endpoint instead of erroring.
      // No new PTY is spawned and no new ring buffer is created.
      const result: SessionCreateResult = { sessionId, dataEndpoint: existing.dataEndpoint }
      sendJson(socket, { jsonrpc: '2.0', id, result })
      return
    }
    if (existing) {
      // The previous PTY for this id died. Tear the husk down completely so the
      // caller gets a live shell rather than a socket nobody is listening on.
      this.destroySession(existing)
      this.sessions.delete(sessionId)
    }

    const buffer = new RingBuffer(scrollbackBytes ?? SCROLLBACK_DEFAULT_BYTES)

    // Spawn the PTY
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: ptyEnv()
    })

    // Determine data endpoint path
    const dataEndpoint = this.resolveDataEndpoint(sessionId)
    ensureSecureDir(dataEndpoint)
    removeSocket(dataEndpoint)

    const dataServer = createServer((dataClient) => {
      const session = this.sessions.get(sessionId)
      if (!session) {
        dataClient.destroy()
        return
      }

      session.dataClients.add(dataClient)

      dataClient.on('data', (chunk: Buffer) => {
        // Bytes from the data client go to the PTY input
        try {
          session.pty.write(chunk.toString('utf8'))
        } catch {
          // PTY may have exited already
        }
      })

      dataClient.on('error', () => {
        session.dataClients.delete(dataClient)
      })

      dataClient.on('close', () => {
        session.dataClients.delete(dataClient)
      })
    })

    const session: Session = {
      sessionId,
      pty: ptyProcess,
      buffer,
      dataEndpoint,
      dataServer,
      dataClients: new Set(),
      exited: false
    }

    this.sessions.set(sessionId, session)

    // Wire PTY output → ring buffer + broadcast to data clients
    ptyProcess.onData((data: string) => {
      const chunk = Buffer.from(data)
      buffer.write(chunk)

      for (const client of session.dataClients) {
        try {
          client.write(chunk)
        } catch {
          session.dataClients.delete(client)
        }
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      // Keep the record (and its ring buffer) so replay still works until the
      // client calls session.kill, but stop accepting new data connections and
      // drop the socket file so it does not linger in ~/.multiterm-studio.
      session.exited = true
      try {
        session.dataServer.close()
      } catch {
        // ignore
      }
      removeSocket(session.dataEndpoint)

      const params: SessionExitParams = { sessionId, exitCode, signal }
      this.broadcastNotification(SESSION_EXIT_METHOD, params)
    })

    // Start the data server, then respond
    dataServer.listen(dataEndpoint, () => {
      // Bytes written to this socket are fed straight into the PTY — owner only.
      secureSocketFile(dataEndpoint)

      // After 300 ms the shell prompt is ready. Write in strict order:
      //   1. OSC 7 hook (if the shell needs one)
      //   2. initialCommand (if provided)
      // Serialising both writes inside the same setTimeout ensures the hook is
      // never overtaken by the initialCommand even when the command launches a
      // TUI app that captures stdin immediately.
      const hook = osc7ShellHook(shell)
      if (hook || initialCommand) {
        setTimeout(() => {
          try {
            if (hook) ptyProcess.write(hook + '\n')
            if (initialCommand) ptyProcess.write(initialCommand + '\n')
          } catch {
            // PTY may have exited already
          }
        }, 300)
      }

      const result: SessionCreateResult = { sessionId, dataEndpoint }
      sendJson(socket, { jsonrpc: '2.0', id, result })
    })

    dataServer.on('error', (err) => {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Data server error: ${err.message}` }
      })
    })
  }

  private handleWrite(
    socket: Socket,
    id: string | number,
    params: { sessionId: string; data: string }
  ): void {
    const session = this.sessions.get(params.sessionId)
    if (!session || session.exited) {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Session not found: ${params.sessionId}` }
      })
      return
    }

    try {
      session.pty.write(params.data)
    } catch (err) {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Write failed: ${(err as Error).message}` }
      })
      return
    }

    sendJson(socket, { jsonrpc: '2.0', id, result: null })
  }

  private handleResize(
    socket: Socket,
    id: string | number,
    params: { sessionId: string; cols: number; rows: number }
  ): void {
    const session = this.sessions.get(params.sessionId)
    if (!session || session.exited) {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Session not found: ${params.sessionId}` }
      })
      return
    }

    try {
      session.pty.resize(params.cols, params.rows)
    } catch (err) {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Resize failed: ${(err as Error).message}` }
      })
      return
    }

    sendJson(socket, { jsonrpc: '2.0', id, result: null })
  }

  private handleKill(socket: Socket, id: string | number, params: { sessionId: string }): void {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      // Killing an already-gone session is idempotent — not an error
      sendJson(socket, { jsonrpc: '2.0', id, result: null })
      return
    }

    this.destroySession(session)
    this.sessions.delete(params.sessionId)
    sendJson(socket, { jsonrpc: '2.0', id, result: null })
  }

  private handleReplay(socket: Socket, id: string | number, params: { sessionId: string }): void {
    const session = this.sessions.get(params.sessionId)
    if (!session) {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: `Session not found: ${params.sessionId}` }
      })
      return
    }

    // Flush ring buffer to all currently connected data clients
    const buffered = session.buffer.replay()
    if (buffered.length > 0) {
      for (const client of session.dataClients) {
        try {
          client.write(buffered)
        } catch {
          session.dataClients.delete(client)
        }
      }
    }

    sendJson(socket, { jsonrpc: '2.0', id, result: null })
  }

  /**
   * Reports whether a command is running in the session, and its name.
   *
   * The shell is the PTY's direct child; anything it runs in the foreground is
   * a child of the shell. Asking `ps` for the shell's children is therefore a
   * good enough proxy, and avoids needing the tty fd that node-pty does not
   * expose.
   */
  private handleForeground(
    socket: Socket,
    id: string | number,
    params: { sessionId: string }
  ): void {
    const session = this.sessions.get(params.sessionId)
    if (!session || session.exited) {
      sendJson(socket, { jsonrpc: '2.0', id, result: { hasProcess: false, processName: null } })
      return
    }

    execFile('ps', ['-o', 'comm=', '--ppid', String(session.pty.pid)], (err, stdout) => {
      if (err) {
        // BSD ps (macOS) does not accept --ppid; fall back to filtering by ppid.
        execFile('ps', ['-o', 'ppid=,comm='], (err2, all) => {
          if (err2) {
            sendJson(socket, {
              jsonrpc: '2.0',
              id,
              result: { hasProcess: false, processName: null }
            })
            return
          }
          const child = all
            .split('\n')
            .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
            .find((m) => m && Number(m[1]) === session.pty.pid)
          sendJson(socket, {
            jsonrpc: '2.0',
            id,
            result: child
              ? { hasProcess: true, processName: baseCommand(child[2]) }
              : { hasProcess: false, processName: null }
          })
        })
        return
      }

      const name = stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)[0]
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        result: name
          ? { hasProcess: true, processName: baseCommand(name) }
          : { hasProcess: false, processName: null }
      })
    })
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private resolveDataEndpoint(sessionId: string): string {
    if (this.sessionDir) {
      return join(this.sessionDir, `mts-data-${sessionId}.sock`)
    }
    return sessionDataEndpointPath(sessionId)
  }

  private destroySession(session: Session): void {
    // Kill data clients
    for (const client of session.dataClients) {
      try {
        client.destroy()
      } catch {
        // ignore
      }
    }
    session.dataClients.clear()

    // Close data server
    try {
      session.dataServer.close()
    } catch {
      // ignore
    }

    removeSocket(session.dataEndpoint)

    // Kill PTY
    try {
      session.pty.kill()
    } catch {
      // PTY may already be gone
    }
  }
}

// ── Module-level utilities ────────────────────────────────────────────────────

/**
 * Variables Electron injects into this process that must not reach the user's
 * shell. The sidecar is forked from Electron, so `process.env` carries
 * ELECTRON_RUN_AS_NODE=1 and friends; inheriting them makes `node`, `npx` and
 * anything else Node-based misbehave inside every terminal.
 */
const STRIPPED_ENV_VARS = [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_NO_ASAR',
  'NODE_OPTIONS',
  'SIDECAR_CONTROL_ENDPOINT'
]

/** The environment a spawned shell should see. */
function ptyEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  for (const key of STRIPPED_ENV_VARS) delete env[key]
  return env
}

/** Strips path and arguments from a `ps` command column. */
function baseCommand(raw: string): string {
  const first = raw.trim().split(/\s+/)[0] ?? raw
  return first.split('/').pop() || first
}

function sendJson(socket: Socket, obj: unknown): void {
  try {
    socket.write(JSON.stringify(obj) + '\n')
  } catch {
    // Socket may have closed; ignore
  }
}

function removeSocket(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // ignore
  }
}

function closeServer(srv: NetServer): Promise<void> {
  return new Promise((resolve) => {
    srv.close(() => resolve())
  })
}
