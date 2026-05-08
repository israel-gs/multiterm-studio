import { createServer, type Server as NetServer, type Socket } from 'net'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { Database } from 'better-sqlite3'
import { ERROR_CODES, type JsonRpcRequest } from './protocol'
import type { EventPublisher } from './messaging'
import { BridgeError } from './tasks'
import { kvSet, kvGet, kvDel, kvList } from './kv'
import { touchAgent, setAlias, listActiveAgents } from './registry'
import { createTask, claimTask, completeTask, releaseTask, failTask, listTasks } from './tasks'
import { sendTo, notify, acceptMessage, declineMessage, rejectAllPending } from './messaging'

// ── Options ───────────────────────────────────────────────────────────────────

export interface BridgeServerOptions {
  db: Database
  publisher: EventPublisher
  /** When false, every method returns -32010 BridgeDisabled. Default: true. */
  enabled?: boolean
  /** Injected clock; defaults to setTimeout. Kept for interface parity with messaging. */
  clock?: unknown
}

// ── BridgeServer ──────────────────────────────────────────────────────────────

/**
 * JSON-RPC 2.0 bridge daemon over a Unix socket.
 * Mirrors the structure of SidecarServer; dispatches to task/kv/registry/messaging subsystems.
 *
 * Concurrency model:
 * - Multiple connections are handled concurrently (each on its own socket).
 * - Requests within a single pane (identified by `params.from`) are serialized
 *   via a per-pane promise chain to keep state transitions predictable.
 */
export class BridgeServer {
  private readonly db: Database
  private readonly publisher: EventPublisher
  private readonly enabled: boolean
  private readonly clock: unknown
  private netServer: NetServer | null = null

  // Per-pane mutex: maps paneId → tail of promise chain.
  // Each new request from a pane appends itself to the chain.
  private readonly paneQueues = new Map<string, Promise<unknown>>()

  constructor(opts: BridgeServerOptions) {
    this.db = opts.db
    this.publisher = opts.publisher
    this.enabled = opts.enabled ?? true
    this.clock = opts.clock
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  listen(endpointPath: string): Promise<void> {
    removeSocket(endpointPath)
    ensureDir(endpointPath)

    return new Promise<void>((resolve, reject) => {
      const srv = createServer((socket) => this.handleConnection(socket))
      this.netServer = srv

      srv.on('error', reject)
      srv.listen(endpointPath, () => resolve())
    })
  }

  close(): Promise<void> {
    // Reject all in-flight messaging promises with BridgeShutdown first so that
    // any connected client receives the error before the socket is torn down.
    rejectAllPending()

    return new Promise<void>((resolve) => {
      if (!this.netServer) {
        resolve()
        return
      }
      this.netServer.close(() => resolve())
      this.netServer = null
    })
  }

  // ── Connection handling ─────────────────────────────────────────────────────

  private handleConnection(socket: Socket): void {
    let buf = ''
    socket.setEncoding('utf8')

    socket.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        this.handleMessage(socket, trimmed)
      }
    })

    socket.on('error', () => {
      // Connection dropped — silently ignore
    })
  }

  private handleMessage(socket: Socket, raw: string): void {
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
    const p = params as Record<string, unknown> | undefined
    const fromPane = (p?.from as string | undefined) ?? '__unknown__'

    // Serialize requests from the same pane to preserve ordering.
    const prev = this.paneQueues.get(fromPane) ?? Promise.resolve()
    const next = prev.then(() => this.dispatch(socket, id, method, p ?? {}))
    // Store the new tail; ignore errors (they are already sent to the client).
    this.paneQueues.set(
      fromPane,
      next.catch(() => {})
    )
  }

  // ── Dispatcher ──────────────────────────────────────────────────────────────

  private async dispatch(
    socket: Socket,
    id: string | number,
    method: string,
    p: Record<string, unknown>
  ): Promise<void> {
    if (!this.enabled) {
      sendJson(socket, {
        jsonrpc: '2.0',
        id,
        error: { code: ERROR_CODES.BridgeDisabled, message: 'Bridge is disabled.' }
      })
      return
    }

    const fromPane = (p.from as string | undefined) ?? '__unknown__'

    // Auto-register the calling pane on every request so that any CLI
    // invocation implicitly registers the pane without a separate call.
    if (fromPane !== '__unknown__') {
      touchAgent(this.db, fromPane)
    }

    try {
      const result = await this.route(method, fromPane, p)
      sendJson(socket, { jsonrpc: '2.0', id, result })
    } catch (err: unknown) {
      if (err instanceof BridgeError) {
        sendJson(socket, {
          jsonrpc: '2.0',
          id,
          error: { code: err.code, message: err.message }
        })
      } else {
        sendJson(socket, {
          jsonrpc: '2.0',
          id,
          error: { code: ERROR_CODES.GenericBridgeError, message: (err as Error).message }
        })
      }
    }
  }

  private async route(
    method: string,
    fromPane: string,
    p: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      // ── KV ──────────────────────────────────────────────────────────────────
      case 'bridge.kv.set': {
        const r = kvSet(this.db, p.key as string, p.value as string)
        if ('error' in r) throw new BridgeError(r.error.code, r.error.message)
        return r
      }
      case 'bridge.kv.get': {
        const r = kvGet(this.db, p.key as string)
        if ('error' in r) throw new BridgeError(r.error.code, r.error.message)
        return r
      }
      case 'bridge.kv.del': {
        const r = kvDel(this.db, p.key as string)
        if ('error' in r) throw new BridgeError(r.error.code, r.error.message)
        return r
      }
      case 'bridge.kv.list':
        return kvList(this.db, p.prefix as string | undefined)

      // ── Tasks ────────────────────────────────────────────────────────────────
      case 'bridge.task.create':
        return createTask(this.db, fromPane, p.name as string, p.body as string | undefined)
      case 'bridge.task.claim':
        return claimTask(this.db, fromPane, p.taskId as string)
      case 'bridge.task.complete':
        return completeTask(this.db, fromPane, p.taskId as string)
      case 'bridge.task.release':
        return releaseTask(this.db, fromPane, p.taskId as string)
      case 'bridge.task.fail':
        return failTask(this.db, fromPane, p.taskId as string)
      case 'bridge.task.list':
        return listTasks(this.db, {
          status: p.status as string | string[] | undefined,
          ownedBy: p.ownedBy as string | undefined
        })

      // ── Agents ───────────────────────────────────────────────────────────────
      case 'bridge.agent.list':
        return listActiveAgents(this.db)
      case 'bridge.agent.alias': {
        const r = setAlias(this.db, fromPane, (p.alias as string | null) ?? null)
        if ('error' in r) throw new BridgeError(r.error.code, r.error.message)
        return r
      }

      // ── Messaging ─────────────────────────────────────────────────────────────
      case 'bridge.send':
        return sendTo(this.db, this.publisher, this.clock, {
          from: fromPane,
          to: p.to as string,
          body: p.body as string,
          timeoutMs: p.timeoutMs as number | undefined
        })
      case 'bridge.notify':
        return notify(this.db, this.publisher, this.clock, {
          from: fromPane,
          to: p.to as string,
          body: p.body as string
        })
      case 'bridge.accept':
        acceptMessage(this.db, this.publisher, p.msgId as string, p.response as string | undefined)
        return { ok: true }
      case 'bridge.decline':
        declineMessage(this.db, this.publisher, p.msgId as string)
        return { ok: true }

      default:
        throw new BridgeError(-32601, `Method not found: ${method}`)
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sendJson(socket: Socket, obj: unknown): void {
  try {
    socket.write(JSON.stringify(obj) + '\n')
  } catch {
    // Socket may have closed already; ignore
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
