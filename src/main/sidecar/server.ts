import { createServer, type Server as NetServer, type Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import * as pty from 'node-pty'
import { RingBuffer } from './ring-buffer'
import { osc7ShellHook } from './shell-init'
import {
  DEFAULT_SCROLLBACK_BYTES,
  sessionDataEndpointPath,
  type SessionCreateParams,
  type SessionCreateResult,
  type JsonRpcRequest
} from './protocol'

// ── Internal session record ───────────────────────────────────────────────────

interface Session {
  sessionId: string
  pty: pty.IPty
  buffer: RingBuffer
  dataEndpoint: string
  dataServer: NetServer
  dataClients: Set<Socket>
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

  constructor(opts: SidecarServerOptions) {
    this.controlEndpoint = opts.controlEndpoint
    this.sessionDir = opts.sessionDir
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async listen(): Promise<void> {
    removeSocket(this.controlEndpoint)
    ensureDir(this.controlEndpoint)

    return new Promise<void>((resolve, reject) => {
      const srv = createServer((socket) => this.handleControlConnection(socket))
      this.controlServer = srv

      srv.on('error', reject)
      srv.listen(this.controlEndpoint, () => resolve())
    })
  }

  async close(): Promise<void> {
    // Close all sessions
    for (const session of this.sessions.values()) {
      this.destroySession(session)
    }
    this.sessions.clear()

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

    socket.on('data', (chunk: string) => {
      buf += chunk
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

    if (this.sessions.has(sessionId)) {
      // Idempotent: return the existing session's endpoint instead of erroring.
      // No new PTY is spawned and no new ring buffer is created.
      const existing = this.sessions.get(sessionId)!
      const result: SessionCreateResult = { sessionId, dataEndpoint: existing.dataEndpoint }
      sendJson(socket, { jsonrpc: '2.0', id, result })
      return
    }

    const buffer = new RingBuffer(scrollbackBytes ?? DEFAULT_SCROLLBACK_BYTES)

    // Spawn the PTY
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env as Record<string, string>
    })

    // Determine data endpoint path
    const dataEndpoint = this.resolveDataEndpoint(sessionId)
    ensureDir(dataEndpoint)
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
      dataClients: new Set()
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

    ptyProcess.onExit(() => {
      // Remove from registry; do not forcibly destroy the data server so
      // replay still works until the next session.kill.
      this.sessions.delete(sessionId)
    })

    // Start the data server, then respond
    dataServer.listen(dataEndpoint, () => {
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
    if (!session) {
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
    if (!session) {
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

function ensureDir(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true })
  } catch {
    // ignore
  }
}

function closeServer(srv: NetServer): Promise<void> {
  return new Promise((resolve) => {
    srv.close(() => resolve())
  })
}
