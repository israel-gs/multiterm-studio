import { createConnection, type Socket } from 'net'
import type { SessionCreateParams, SessionCreateResult } from './protocol'

// ── Pending RPC call state ─────────────────────────────────────────────────────

interface PendingCall {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
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
        for (const pending of this.pending.values()) {
          pending.reject(err)
        }
        this.pending.clear()
      })

      sock.on('close', () => {
        for (const pending of this.pending.values()) {
          pending.reject(new Error('Control socket closed'))
        }
        this.pending.clear()
      })

      sock.on('connect', () => {
        this.controlSocket = sock
        resolve()
      })

      sock.on('error', reject)
    })
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
      if (!this.controlSocket) {
        reject(new Error('Not connected'))
        return
      }

      const id = this.nextId++
      this.pending.set(id, { resolve, reject })

      const msg: Record<string, unknown> = { jsonrpc: '2.0', id, method }
      if (params !== undefined) msg.params = params

      try {
        this.controlSocket.write(JSON.stringify(msg) + '\n')
      } catch (err) {
        this.pending.delete(id)
        reject(err)
      }
    })
  }

  private handleMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: { code: number; message: string } }

    try {
      msg = JSON.parse(raw)
    } catch {
      // Malformed — cannot correlate; ignore
      return
    }

    const { id, result, error } = msg

    if (id === undefined || id === null) return

    const pending = this.pending.get(id as number)
    if (!pending) return

    this.pending.delete(id as number)

    if (error) {
      pending.reject(new Error(`JSON-RPC error ${error.code}: ${error.message}`))
    } else {
      pending.resolve(result)
    }
  }
}
