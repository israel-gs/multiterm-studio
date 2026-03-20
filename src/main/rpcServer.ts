import { createServer, connect, type Server, type Socket } from 'net'
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { splitAgentPane } from './ptyManager'

const DISCOVERY_DIR = join(homedir(), '.multiterm-studio')
const DISCOVERY_FILE = join(DISCOVERY_DIR, 'socket-path')

// Agent session tracking — links Claude session IDs to PTY panel IDs
interface AgentSession {
  sessionId: string
  cwd: string
  ptySessionId: string | null
  startedAt: number
}

const sessions = new Map<string, AgentSession>()

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
        handleMessage(line, win)
      }
    })
  })

  server.listen(socketPath)

  if (!existsSync(DISCOVERY_DIR)) {
    mkdirSync(DISCOVERY_DIR, { recursive: true })
  }
  writeFileSync(DISCOVERY_FILE, socketPath, 'utf-8')

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

function handleMessage(raw: string, win: BrowserWindow): void {
  let msg: { jsonrpc?: string; method?: string; params?: Record<string, unknown> }
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  if (msg.jsonrpc !== '2.0' || !msg.method || !msg.params) return

  if (msg.method === 'agent.spawning') {
    const ptySessionId = String(msg.params.pty_session_id ?? '')
    const subagentsDir = String(msg.params.subagents_dir ?? '')
    const viewerPath = String(msg.params.viewer_path ?? '')
    const agentName = String(msg.params.agent_name ?? 'agent')

    if (ptySessionId && subagentsDir && viewerPath) {
      // Try to create a tmux pane within the existing terminal
      const viewerCmd = `node "${viewerPath}" "${subagentsDir}"`
      const created = splitAgentPane(ptySessionId, viewerCmd)

      if (!created) {
        // Fallback: notify renderer to create a separate terminal card
        win.webContents.send('agent:spawning', {
          agentName,
          toolUseId: String(msg.params.tool_use_id ?? ''),
          subagentsDir,
          cwd: String(msg.params.cwd ?? '')
        })
      }
    }
  } else if (msg.method === 'agent.sessionStart') {
    const sessionId = String(msg.params.session_id ?? '')
    const cwd = String(msg.params.cwd ?? '')
    const ptySessionId = String(msg.params.pty_session_id ?? '') || null

    if (!sessionId) return
    if (sessions.has(sessionId)) return

    const session: AgentSession = {
      sessionId,
      cwd,
      ptySessionId,
      startedAt: Date.now()
    }
    sessions.set(sessionId, session)

    win.webContents.send('agent:session-started', {
      sessionId,
      ptySessionId,
      cwd
    })
  } else if (msg.method === 'agent.fileTouched') {
    const sessionId = String(msg.params.session_id ?? '')
    const session = sessions.get(sessionId)
    if (!session) return

    const filePath = msg.params.file_path ? String(msg.params.file_path) : null
    if (!filePath) return

    const toolName = String(msg.params.tool_name ?? '')
    const touchType = toolName === 'Read' ? 'read' : 'write'

    win.webContents.send('agent:file-touched', {
      sessionId,
      ptySessionId: session.ptySessionId,
      filePath,
      touchType
    })
  } else if (msg.method === 'agent.sessionEnd') {
    const sessionId = String(msg.params.session_id ?? '')
    const session = sessions.get(sessionId)
    if (!session) return

    sessions.delete(sessionId)

    win.webContents.send('agent:session-ended', {
      sessionId,
      ptySessionId: session.ptySessionId
    })
  }
}
