import { createServer, connect, type Server, type Socket } from 'net'
import { BrowserWindow, ipcMain } from 'electron'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { writeToPty, listPtySessions } from './ptyManager'

const DISCOVERY_DIR = join(homedir(), '.multiterm-studio')
const DISCOVERY_FILE = join(DISCOVERY_DIR, 'socket-path')

// --- Agent session tracking ---

interface AgentSession {
  sessionId: string
  cwd: string
  ptySessionId: string | null
  startedAt: number
}

const agentSessions = new Map<string, AgentSession>()

// --- Per-session variables (for pane.setVar / pane.getVar) ---

const sessionVars = new Map<string, Map<string, string>>()

// --- Method registry ---

type RpcHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

interface MethodEntry {
  handler: RpcHandler
  description: string
}

const methods = new Map<string, MethodEntry>()

function registerMethod(name: string, handler: RpcHandler, meta?: { description: string }): void {
  methods.set(name, { handler, description: meta?.description ?? '' })
}

// --- JSON-RPC helpers ---

function makeErrorResponse(id: number | string | null, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

// --- Stale socket check ---

function tryRemoveStaleSocket(socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    if (!existsSync(socketPath)) {
      resolve()
      return
    }
    const probe = connect(socketPath)
    probe.on('error', () => {
      try {
        unlinkSync(socketPath)
      } catch {
        // ignore
      }
      resolve()
    })
    probe.on('connect', () => {
      probe.destroy()
      resolve()
    })
  })
}

// --- Main message handler (bidirectional) ---

async function handleMessage(raw: string, _win: BrowserWindow, conn: Socket): Promise<void> {
  let msg: {
    jsonrpc?: string
    id?: number | string
    method?: string
    params?: Record<string, unknown>
  }
  try {
    msg = JSON.parse(raw)
  } catch {
    if (conn && !conn.destroyed) {
      conn.write(JSON.stringify(makeErrorResponse(null, -32700, 'Parse error')) + '\n')
    }
    return
  }

  if (msg.jsonrpc !== '2.0' || !msg.method) {
    if (msg.id != null && conn && !conn.destroyed) {
      conn.write(
        JSON.stringify(makeErrorResponse(msg.id ?? null, -32600, 'Invalid request')) + '\n'
      )
    }
    return
  }

  const entry = methods.get(msg.method)
  if (!entry) {
    if (msg.id != null && conn && !conn.destroyed) {
      conn.write(
        JSON.stringify(makeErrorResponse(msg.id, -32601, `Method not found: ${msg.method}`)) + '\n'
      )
    }
    return
  }

  try {
    const result = await entry.handler(msg.params ?? {})
    if (msg.id != null && conn && !conn.destroyed) {
      conn.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n')
    }
  } catch (err) {
    if (msg.id != null && conn && !conn.destroyed) {
      const message = err instanceof Error ? err.message : String(err)
      conn.write(JSON.stringify(makeErrorResponse(msg.id, -32000, message)) + '\n')
    }
  }
}

// --- Server startup ---

export async function startRpcServer(
  win: BrowserWindow
): Promise<{ socketPath: string; cleanup: () => void }> {
  const socketPath = `/tmp/multiterm-studio-${process.pid}.sock`

  await tryRemoveStaleSocket(socketPath)

  const server: Server = createServer((conn: Socket) => {
    let buffer = ''
    conn.on('data', (chunk) => {
      buffer += chunk.toString()
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx)
        buffer = buffer.slice(newlineIdx + 1)
        if (line.trim().length > 0) {
          void handleMessage(line, win, conn)
        }
      }
    })
  })

  server.listen(socketPath)

  if (!existsSync(DISCOVERY_DIR)) {
    mkdirSync(DISCOVERY_DIR, { recursive: true })
  }
  writeFileSync(DISCOVERY_FILE, socketPath, 'utf-8')

  // --- Register all methods ---

  registerMethod(
    'rpc.discover',
    () => {
      return {
        methods: [...methods.entries()].map(([name, entry]) => ({
          name,
          description: entry.description
        }))
      }
    },
    { description: 'List all available RPC methods' }
  )

  // --- Agent session methods ---

  registerMethod(
    'agent.spawning',
    (params) => {
      const agentName = String(params.agent_name ?? 'agent')
      const toolUseId = String(params.tool_use_id ?? '')
      const subagentsDir = String(params.subagents_dir ?? '')
      const ptySessionId = String(params.pty_session_id ?? '')
      const cwd = String(params.cwd ?? '')

      win.webContents.send('agent:spawning', {
        agentName,
        toolUseId,
        subagentsDir,
        ptySessionId,
        cwd
      })
      return { ok: true }
    },
    { description: 'Handle agent subagent spawning — notifies pane sidebar' }
  )

  registerMethod(
    'agent.sessionStart',
    (params) => {
      const sessionId = String(params.session_id ?? '')
      const cwd = String(params.cwd ?? '')
      const ptySessionId = String(params.pty_session_id ?? '') || null

      if (!sessionId || agentSessions.has(sessionId)) return { ok: true }

      agentSessions.set(sessionId, {
        sessionId,
        cwd,
        ptySessionId,
        startedAt: Date.now()
      })

      win.webContents.send('agent:session-started', { sessionId, ptySessionId, cwd })
      return { ok: true }
    },
    { description: 'Register a new agent session' }
  )

  registerMethod(
    'agent.fileTouched',
    (params) => {
      const sessionId = String(params.session_id ?? '')
      const session = agentSessions.get(sessionId)
      if (!session) return { ok: false }

      const filePath = params.file_path ? String(params.file_path) : null
      if (!filePath) return { ok: false }

      const toolName = String(params.tool_name ?? '')
      const touchType = toolName === 'Read' ? 'read' : 'write'

      win.webContents.send('agent:file-touched', {
        sessionId,
        ptySessionId: session.ptySessionId,
        filePath,
        touchType
      })
      return { ok: true }
    },
    { description: 'Log a file read/write by an agent' }
  )

  registerMethod(
    'agent.sessionEnd',
    (params) => {
      const sessionId = String(params.session_id ?? '')
      const session = agentSessions.get(sessionId)
      if (!session) return { ok: true }

      agentSessions.delete(sessionId)

      win.webContents.send('agent:session-ended', {
        sessionId,
        ptySessionId: session.ptySessionId
      })
      return { ok: true }
    },
    { description: 'End an agent session' }
  )

  // --- Pane management methods ---

  registerMethod(
    'pane.split',
    (params) => {
      const newId = randomUUID()
      const cwd = String(params.cwd ?? '')
      const title = params.title ? String(params.title) : undefined
      const parentSessionId = params.session_id ? String(params.session_id) : undefined

      return new Promise<{ session_id: string }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ipcMain.removeAllListeners(`pane:created:${newId}`)
          reject(new Error('Pane creation timed out'))
        }, 5_000)

        ipcMain.once(`pane:created:${newId}`, () => {
          clearTimeout(timeout)
          resolve({ session_id: newId })
        })

        win.webContents.send('pane:create', { sessionId: newId, cwd, title, parentSessionId })
      })
    },
    { description: 'Create a new interactive terminal pane' }
  )

  registerMethod(
    'pane.sendText',
    (params) => {
      const id = String(params.session_id ?? '')
      const text = String(params.text ?? '')
      return { ok: writeToPty(id, text) }
    },
    { description: 'Send text to a PTY session' }
  )

  registerMethod(
    'pane.runCommand',
    (params) => {
      const id = String(params.session_id ?? '')
      const command = String(params.command ?? '')
      return { ok: writeToPty(id, command + '\r') }
    },
    { description: 'Run a command in a PTY session' }
  )

  registerMethod(
    'pane.list',
    () => {
      return { sessions: listPtySessions().map((id) => ({ session_id: id })) }
    },
    { description: 'List all active PTY sessions' }
  )

  registerMethod(
    'pane.focus',
    (params) => {
      const id = String(params.session_id ?? '')
      win.webContents.send('pane:focus', { sessionId: id })
      return { ok: true }
    },
    { description: 'Focus a specific terminal pane' }
  )

  registerMethod(
    'pane.setVar',
    (params) => {
      const id = String(params.session_id ?? '')
      const variable = String(params.variable ?? '')
      const value = String(params.value ?? '')
      if (!sessionVars.has(id)) sessionVars.set(id, new Map())
      sessionVars.get(id)!.set(variable, value)
      return { ok: true }
    },
    { description: 'Set a session variable' }
  )

  registerMethod(
    'pane.getVar',
    (params) => {
      const id = String(params.session_id ?? '')
      const variable = String(params.variable ?? '')
      const value = sessionVars.get(id)?.get(variable) ?? null
      return { value }
    },
    { description: 'Get a session variable' }
  )

  // --- App methods ---

  registerMethod(
    'app.notify',
    (params) => {
      const { Notification } = require('electron')
      const note = new Notification({
        title: String(params.title ?? 'Multiterm Studio'),
        body: String(params.body ?? '')
      })
      note.show()
      return { ok: true }
    },
    { description: 'Show a native macOS notification' }
  )

  registerMethod('ping', () => ({ pong: true }), {
    description: 'Health check'
  })

  // --- Cleanup ---

  function cleanup(): void {
    server.close()
    try {
      unlinkSync(socketPath)
    } catch {
      // ignore
    }
    try {
      const current = readFileSync(DISCOVERY_FILE, 'utf-8').trim()
      if (current === socketPath) {
        unlinkSync(DISCOVERY_FILE)
      }
    } catch {
      // ignore
    }
  }

  return { socketPath, cleanup }
}
