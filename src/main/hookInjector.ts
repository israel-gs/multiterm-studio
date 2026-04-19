import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOOK_MARKER = 'multiterm-studio'

const NOTIFY_SCRIPT = `#!/usr/bin/env node
const fs = require('fs'), net = require('net'), os = require('os'), path = require('path')
let input = ''
process.stdin.on('data', c => input += c)
process.stdin.on('end', () => {
  let socketPath
  try { socketPath = fs.readFileSync(path.join(os.homedir(), '.multiterm-studio', 'socket-path'), 'utf-8').trim() } catch { process.exit(0) }
  let data
  try { data = JSON.parse(input) } catch { process.exit(0) }
  try {
    fs.appendFileSync(path.join(os.homedir(), '.multiterm-studio', 'hook-debug.log'),
      new Date().toISOString() + ' ' + JSON.stringify(data) + '\\n')
  } catch {}
  let method, params
  switch (data.hook_event_name) {
    case 'SessionStart':
      method = 'agent.sessionStart'
      params = {
        session_id: data.session_id,
        cwd: data.cwd,
        pty_session_id: process.env.MULTITERM_PTY_SESSION_ID || ''
      }
      break
    case 'PreToolUse':
      if (data.tool_name !== 'Agent') { process.exit(0) }
      method = 'agent.spawning'
      var ti = data.tool_input || {}
      var subDir = path.join(path.dirname(data.transcript_path), data.session_id, 'subagents')
      params = {
        agent_name: ti.name || ti.description || 'agent',
        tool_use_id: data.tool_use_id || String(Date.now()),
        subagents_dir: subDir,
        viewer_path: path.join(__dirname, 'multiterm-agent-viewer.cjs'),
        pty_session_id: process.env.MULTITERM_PTY_SESSION_ID || '',
        cwd: data.cwd
      }
      break
    case 'PostToolUse':
      method = 'agent.fileTouched'
      params = {
        session_id: data.session_id,
        tool_name: data.tool_name,
        file_path: (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || null
      }
      break
    case 'SessionEnd':
      method = 'agent.sessionEnd'
      params = { session_id: data.session_id }
      break
    default:
      process.exit(0)
  }
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\\n'
  const client = net.createConnection(socketPath, () => { client.write(msg); client.end() })
  client.on('error', () => process.exit(0))
})
`

function makeHookEntry(projectPath: string): {
  _source: string
  hooks: Array<{ type: string; command: string; timeout: number }>
} {
  const scriptPath = join(projectPath, '.claude', 'hooks', 'multiterm-notify.cjs')
  return {
    _source: HOOK_MARKER,
    hooks: [{ type: 'command', command: `node "${scriptPath}"`, timeout: 5 }]
  }
}

function makePostToolUseEntry(projectPath: string): {
  _source: string
  matcher: string
  hooks: Array<{ type: string; command: string; timeout: number }>
} {
  const scriptPath = join(projectPath, '.claude', 'hooks', 'multiterm-notify.cjs')
  return {
    _source: HOOK_MARKER,
    matcher: 'Read|Write|Edit',
    hooks: [{ type: 'command', command: `node "${scriptPath}"`, timeout: 5 }]
  }
}

function makePreToolUseEntry(projectPath: string): {
  _source: string
  matcher: string
  hooks: Array<{ type: string; command: string; timeout: number }>
} {
  const scriptPath = join(projectPath, '.claude', 'hooks', 'multiterm-notify.cjs')
  return {
    _source: HOOK_MARKER,
    matcher: 'Agent',
    hooks: [{ type: 'command', command: `node "${scriptPath}"`, timeout: 5 }]
  }
}

const VIEWER_SCRIPT = `#!/usr/bin/env node
const fs = require('fs'), path = require('path')
const dir = process.argv[2]
if (!dir) process.exit(1)
const DIM='\\x1b[2m',RST='\\x1b[0m',BOLD='\\x1b[1m',CYAN='\\x1b[36m',MAG='\\x1b[35m',GRN='\\x1b[32m',WHT='\\x1b[37m'
const ex = new Set()
try { fs.readdirSync(dir).forEach(f => { if (f.startsWith('agent-') && f.endsWith('.jsonl')) ex.add(f) }) } catch {}
let claimed = false, pos = 0
process.stdout.write(DIM + 'Waiting for agent...' + RST + '\\n')
const poll = setInterval(() => {
  if (claimed) return
  try { fs.readdirSync(dir).forEach(f => {
    if (!claimed && f.startsWith('agent-') && f.endsWith('.jsonl') && !ex.has(f)) {
      claimed = true; ex.add(f); clearInterval(poll)
      process.stdout.write('\\x1b[2K\\x1b[1A\\x1b[2K')
      const fp = path.join(dir, f)
      setInterval(() => {
        try {
          const s = fs.statSync(fp).size; if (s <= pos) return
          const b = Buffer.alloc(s - pos), fd = fs.openSync(fp, 'r')
          fs.readSync(fd, b, 0, b.length, pos); fs.closeSync(fd); pos = s
          b.toString().split('\\n').forEach(l => { if (!l.trim()) return; try { const d = JSON.parse(l)
            if (d.type === 'assistant' && d.message && d.message.content) {
              d.message.content.forEach(c => {
                if (c.type === 'text') process.stdout.write(WHT + c.text + RST + '\\n')
                if (c.type === 'tool_use') {
                  let detail = ''
                  if (c.input) {
                    if (c.name === 'Bash' && c.input.command) detail = ' $ ' + c.input.command.split('\\n')[0]
                    else if (c.input.file_path) detail = ' ' + c.input.file_path
                    else if (c.input.pattern) detail = ' ' + c.input.pattern
                    else if (c.input.description) detail = ' ' + c.input.description
                  }
                  process.stdout.write(CYAN + BOLD + '  \\u25b8 ' + c.name + RST + DIM + detail + RST + '\\n')
                }
              })
            }
            if (d.type === 'result') process.stdout.write('\\n' + GRN + BOLD + '\\u2713 Done' + RST + '\\n')
          } catch {} })
        } catch {}
      }, 200)
    }
  }) } catch {}
}, 200)
`

export async function injectHooks(projectPath: string): Promise<void> {
  const hooksDir = join(projectPath, '.claude', 'hooks')
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true })
  }
  writeFileSync(join(hooksDir, 'multiterm-notify.cjs'), NOTIFY_SCRIPT, { mode: 0o755 })
  writeFileSync(join(hooksDir, 'multiterm-agent-viewer.cjs'), VIEWER_SCRIPT, { mode: 0o755 })

  const settingsPath = join(projectPath, '.claude', 'settings.json')
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch {
      // corrupt settings — start fresh
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>

  // Clean up all stale multiterm-studio entries
  for (const event of Object.keys(hooks)) {
    if (Array.isArray(hooks[event])) {
      hooks[event] = hooks[event].filter(
        (e) =>
          !(e && typeof e === 'object' && (e as Record<string, unknown>)._source === HOOK_MARKER)
      )
    }
  }

  const entry = makeHookEntry(projectPath)

  // SessionStart and SessionEnd — standard hooks
  for (const event of ['SessionStart', 'SessionEnd']) {
    if (!Array.isArray(hooks[event])) hooks[event] = []
    hooks[event].push(entry)
  }

  // PostToolUse with Read|Write|Edit matcher — track file activity
  if (!Array.isArray(hooks['PostToolUse'])) hooks['PostToolUse'] = []
  hooks['PostToolUse'].push(makePostToolUseEntry(projectPath))

  // PreToolUse with Agent matcher — detect agent spawning for panel creation
  if (!Array.isArray(hooks['PreToolUse'])) hooks['PreToolUse'] = []
  hooks['PreToolUse'].push(makePreToolUseEntry(projectPath))

  settings.hooks = hooks
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

export async function removeHooks(projectPath: string): Promise<void> {
  const settingsPath = join(projectPath, '.claude', 'settings.json')
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
      const hooks = settings.hooks as Record<string, unknown[]> | undefined
      if (hooks) {
        for (const event of Object.keys(hooks)) {
          if (Array.isArray(hooks[event])) {
            hooks[event] = hooks[event].filter(
              (e) =>
                !(
                  e &&
                  typeof e === 'object' &&
                  (e as Record<string, unknown>)._source === HOOK_MARKER
                )
            )
          }
        }
        settings.hooks = hooks
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
      }
    } catch {
      // ignore
    }
  }

  for (const name of ['multiterm-notify.cjs', 'multiterm-agent-viewer.cjs']) {
    try {
      unlinkSync(join(projectPath, '.claude', 'hooks', name))
    } catch {
      // ignore
    }
  }
}

// --- OpenCode integration ---

const OPENCODE_PLUGIN_NAME = 'multiterm-studio.js'

const OPENCODE_PLUGIN_SCRIPT = `// multiterm-studio plugin for OpenCode
// Sends session and tool events to the Multiterm Studio RPC server
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

function getSocketPath() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.multiterm-studio', 'socket-path'), 'utf-8').trim()
  } catch { return null }
}

function sendRpc(method, params) {
  const socketPath = getSocketPath()
  if (!socketPath) return
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) + '\\n'
  try {
    const client = net.createConnection(socketPath, () => { client.write(msg); client.end() })
    client.on('error', () => {})
  } catch {}
}

module.exports = function(ctx) {
  const ptySessionId = process.env.MULTITERM_PTY_SESSION_ID || ''
  return {
    session: {
      onCreated(session) {
        sendRpc('agent.sessionStart', {
          session_id: session.id || String(Date.now()),
          cwd: ctx.directory || process.cwd(),
          pty_session_id: ptySessionId
        })
      },
      onError() {},
      onFinished(session) {
        sendRpc('agent.sessionEnd', {
          session_id: session.id || String(Date.now())
        })
      }
    },
    tool: {
      onCallStart(tool) {
        if (['read', 'write', 'edit'].includes((tool.name || '').toLowerCase())) {
          sendRpc('agent.fileTouched', {
            session_id: tool.sessionId || '',
            tool_name: tool.name || '',
            file_path: (tool.input && (tool.input.file_path || tool.input.path)) || null
          })
        }
      }
    }
  }
}
`

/** Check if OpenCode is available on this system */
export function isOpenCodeAvailable(): boolean {
  const home = homedir()
  if (existsSync(join(home, '.opencode'))) return true
  try {
    const paths = (process.env.PATH ?? '').split(':')
    return paths.some((p) => existsSync(join(p, 'opencode')))
  } catch {
    return false
  }
}

/** Inject the multiterm-studio plugin into an OpenCode project */
export async function injectOpenCodeHooks(projectPath: string): Promise<void> {
  if (!isOpenCodeAvailable()) return

  const pluginsDir = join(projectPath, '.opencode', 'plugins')
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true })
  }

  writeFileSync(join(pluginsDir, OPENCODE_PLUGIN_NAME), OPENCODE_PLUGIN_SCRIPT, { mode: 0o644 })
}

/** Remove the multiterm-studio plugin from an OpenCode project */
export async function removeOpenCodeHooks(projectPath: string): Promise<void> {
  const pluginPath = join(projectPath, '.opencode', 'plugins', OPENCODE_PLUGIN_NAME)
  try {
    unlinkSync(pluginPath)
  } catch {
    // ignore
  }

  // Clean up empty plugins dir
  const pluginsDir = join(projectPath, '.opencode', 'plugins')
  try {
    if (existsSync(pluginsDir) && readdirSync(pluginsDir).length === 0) {
      unlinkSync(pluginsDir)
    }
  } catch {
    // ignore
  }
}

// --- Codex CLI integration ---

const CODEX_INSTRUCTION_FILE = 'multiterm-studio.md'

const CODEX_INSTRUCTION = `# Multiterm Studio Integration

When running inside Multiterm Studio, the environment variable
\`MULTITERM_PTY_SESSION_ID\` identifies the terminal session.

A JSON-RPC 2.0 server is available at the Unix socket path stored in
\`~/.multiterm-studio/socket-path\`. You can send notifications:

- \`agent.sessionStart\` — announce your session
- \`agent.fileTouched\` — log file read/write
- \`agent.sessionEnd\` — signal completion

Use \`pane.split\` to open new terminal panes, \`pane.sendText\` to type
into them, and \`pane.focus\` to bring a pane to front.
`

function isCodexAvailable(): boolean {
  const home = homedir()
  if (existsSync(join(home, '.codex'))) return true
  try {
    const paths = (process.env.PATH ?? '').split(':')
    return paths.some((p) => existsSync(join(p, 'codex')))
  } catch {
    return false
  }
}

export async function injectCodexHooks(projectPath: string): Promise<void> {
  if (!isCodexAvailable()) return
  const dir = join(projectPath, '.codex', 'instructions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, CODEX_INSTRUCTION_FILE), CODEX_INSTRUCTION, 'utf-8')
}

export async function removeCodexHooks(projectPath: string): Promise<void> {
  try {
    unlinkSync(join(projectPath, '.codex', 'instructions', CODEX_INSTRUCTION_FILE))
  } catch {
    /* ignore */
  }
}

// --- Gemini CLI integration ---

const GEMINI_INSTRUCTION_FILE = 'multiterm-studio.md'

function isGeminiAvailable(): boolean {
  const home = homedir()
  if (existsSync(join(home, '.gemini'))) return true
  try {
    const paths = (process.env.PATH ?? '').split(':')
    return paths.some((p) => existsSync(join(p, 'gemini')))
  } catch {
    return false
  }
}

export async function injectGeminiHooks(projectPath: string): Promise<void> {
  if (!isGeminiAvailable()) return
  const dir = join(projectPath, '.gemini', 'instructions')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, GEMINI_INSTRUCTION_FILE), CODEX_INSTRUCTION, 'utf-8')
}

export async function removeGeminiHooks(projectPath: string): Promise<void> {
  try {
    unlinkSync(join(projectPath, '.gemini', 'instructions', GEMINI_INSTRUCTION_FILE))
  } catch {
    /* ignore */
  }
}
