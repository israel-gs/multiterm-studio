import { createConnection, type Socket } from 'net'
import {
  SESSION_EXIT_METHOD,
  type SessionCreateParams,
  type SessionCreateResult,
  type SessionExitParams
} from './protocol'

/**
 * How long to wait for a control-socket reply before giving up. Without this a
 * sidecar that dies mid-call leaves the caller — and the terminal waiting on
 * it — hanging forever.
 */
const CALL_TIMEOUT_MS = 10_000

// ── Pending RPC call state ─────────────────────────────────────────────────────

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// ── SidecarClient ─────────────────────────────────────────────────────────────

/**
 * Client for the SidecarServer JSON-RPC 2.0 control socket.
 *
 * All requests are correlated by a monotonically-incrementing numeric id so
 * concurrent calls resolve independently regardless of response order.
 */
export class SidecarClient {
  private controlSocket: Socket | null = null
  private nextId = 1
  private readonly pending = new Map<number, PendingCall>()
  private readBuf = ''

  /** Per-session raw data sockets created by onData(). */
  private readonly dataSockets = new Map<string, Socket>()

  /** Listeners notified when the sidecar reports that a PTY has exited. */
  private readonly exitListeners = new Set<(params: SessionExitParams) => void>()

  /** Listeners notified when the control connection drops unexpectedly. */
  private readonly disconnectListeners = new Set<() => void>()

  // ── Connection ───────────────────────────────────────────────────────────────

  async connect(controlEndpoint: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const sock = createConnection(controlEndpoint)

      sock.setEncoding('utf8')

      sock.on('data', (chunk: string) => {
        this.readBuf += chunk
        const lines = this.readBuf.split('\n')
        this.readBuf = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.length === 0) continue
          this.handleMessage(trimmed)
        }
      })

      sock.on('error', (err) => {
        // Reject all in-flight calls on connection error
        this.failPending(err)
        reject(err)
      })

      sock.on('close', () => {
        const wasConnected = this.controlSocket === sock
        // Drop the reference so later calls fail fast with "Not connected"
        // instead of writing into a dead socket and never being answered.
        if (wasConnected) this.controlSocket = null
        this.failPending(new Error('Control socket closed'))
        if (wasConnected) {
          for (const listener of this.disconnectListeners) listener()
        }
      })

      sock.on('connect', () => {
        this.controlSocket = sock
        resolve()
      })
    })
  }

  /** Registers a callback fired when a PTY session exits. Returns an unsubscribe fn. */
  onSessionExit(cb: (params: SessionExitParams) => void): () => void {
    this.exitListeners.add(cb)
    return () => this.exitListeners.delete(cb)
  }

  /** Registers a callback fired when the control connection is lost. */
  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.add(cb)
    return () => this.disconnectListeners.delete(cb)
  }

  /** True while the control socket is usable. */
  get connected(): boolean {
    return this.controlSocket !== null && !this.controlSocket.destroyed
  }

  private failPending(err: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }

  disconnect(): void {
    // Close all data sockets
    for (const sock of this.dataSockets.values()) {
      try {
        sock.destroy()
      } catch {
        // ignore
      }
    }
    this.dataSockets.clear()

    // Close control socket
    if (this.controlSocket) {
      try {
        this.controlSocket.destroy()
      } catch {
        // ignore
      }
      this.controlSocket = null
    }
  }

  // ── RPC methods ──────────────────────────────────────────────────────────────

  async create(params: SessionCreateParams): Promise<SessionCreateResult> {
    const result = await this.call('session.create', params)
    return result as SessionCreateResult
  }

  async write(sessionId: string, data: string): Promise<void> {
    await this.call('session.write', { sessionId, data })
  }

  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    await this.call('session.resize', { sessionId, cols, rows })
  }

  async kill(sessionId: string): Promise<void> {
    await this.call('session.kill', { sessionId })
  }

  async replay(sessionId: string): Promise<void> {
    await this.call('session.replay', { sessionId })
  }

  /** Whether a command is currently running in the session's shell. */
  async foreground(
    sessionId: string
  ): Promise<{ hasProcess: boolean; processName: string | null }> {
    const result = await this.call('session.foreground', { sessionId })
    return result as { hasProcess: boolean; processName: string | null }
  }

  // ── Data socket subscription ──────────────────────────────────────────────────

  /**
   * Opens a raw connection to the session's data endpoint and calls `cb` for
   * each chunk of bytes received. The socket is stored and closed by
   * `disconnect()`.
   *
   * Returns a Promise that resolves once the underlying socket's `connect`
   * event fires — guaranteeing the server has accepted the connection and can
   * add this client to `session.dataClients` before any replay is triggered.
   *
   * If a socket is already registered for `sessionId`, the Promise resolves
   * immediately (the existing callback continues to fire; no second socket is
   * opened and the old callback is not replaced).
   *
   * Rejects if the socket emits an `error` before `connect`.
   */
  onData(sessionId: string, dataEndpoint: string, cb: (chunk: Buffer) => void): Promise<void> {
    if (this.dataSockets.has(sessionId)) {
      // Already subscribed — resolve immediately without opening a second socket.
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const sock = createConnection(dataEndpoint)
      this.dataSockets.set(sessionId, sock)

      sock.on('data', (chunk: Buffer) => cb(chunk))

      sock.on('connect', () => {
        resolve()
      })

      sock.on('error', (err) => {
        this.dataSockets.delete(sessionId)
        reject(err)
      })

      sock.on('close', () => {
        this.dataSockets.delete(sessionId)
      })
    })
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private call(method: string, params?: unknown): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Sidecar is not connected'))
        return
      }

      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Sidecar call timed out after ${CALL_TIMEOUT_MS} ms: ${method}`))
      }, CALL_TIMEOUT_MS)
      timer.unref?.()

      this.pending.set(id, { resolve, reject, timer })

      const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params

      try {
        this.controlSocket!.write(JSON.stringify(msg) + '\n')
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err as Error)
      }
    })
  }

  private handleMessage(raw: string): void {
    let msg: {
      id?: number
      method?: string
      params?: unknown
      result?: unknown
      error?: { code: number; message: string }
    }

    try {
      msg = JSON.parse(raw)
    } catch {
      // Malformed — cannot correlate; ignore
      return
    }

    const { id, result, error } = msg

    // Server → client notifications carry a method and no id.
    if (id === undefined || id === null) {
      if (msg.method === SESSION_EXIT_METHOD && msg.params) {
        const params = msg.params as SessionExitParams
        for (const listener of this.exitListeners) listener(params)
      }
      return
    }

    const pending = this.pending.get(id as number)
    if (!pending) return

    this.pending.delete(id as number)
    clearTimeout(pending.timer)

    if (error) {
      pending.reject(new Error(`JSON-RPC error ${error.code}: ${error.message}`))
    } else {
      pending.resolve(result)
    }
  }
}
