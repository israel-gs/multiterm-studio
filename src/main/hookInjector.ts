import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
  rmdirSync
} from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const HOOK_MARKER = 'multiterm-studio'

/**
 * Hook scripts live in the app's own state directory, not inside the user's
 * repository: they are identical for every project and writing them into
 * `.claude/hooks/` littered checkouts with generated files.
 */
const SHARED_HOOKS_DIR = join(homedir(), '.multiterm-studio', 'hooks')
const NOTIFY_SCRIPT_PATH = join(SHARED_HOOKS_DIR, 'multiterm-notify.cjs')

/**
 * Registration goes in `settings.local.json` — the per-developer file — because
 * `settings.json` is committed, and pushing machine-specific hook paths there
 * changes the behaviour of Claude Code for the whole team.
 */
const LOCAL_SETTINGS = 'settings.local.json'
const SHARED_SETTINGS = 'settings.json'

const NOTIFY_SCRIPT = `#!/usr/bin/env node
const fs = require('fs'), net = require('net'), os = require('os'), path = require('path')
let input = ''
process.stdin.on('data', c => input += c)
process.stdin.on('end', () => {
  const stateDir = path.join(os.homedir(), '.multiterm-studio')
  let socketPath, token
  try { socketPath = fs.readFileSync(path.join(stateDir, 'socket-path'), 'utf-8').trim() } catch { process.exit(0) }
  try { token = fs.readFileSync(path.join(stateDir, 'socket-token'), 'utf-8').trim() } catch { process.exit(0) }
  let data
  try { data = JSON.parse(input) } catch { process.exit(0) }
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
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params, token }) + '\\n'
  const client = net.createConnection(socketPath, () => { client.write(msg); client.end() })
  client.on('error', () => process.exit(0))
})
`

interface HookEntry {
  _source: string
  matcher?: string
  hooks: Array<{ type: string; command: string; timeout: number }>
}

function makeHookEntry(matcher?: string): HookEntry {
  const entry: HookEntry = {
    _source: HOOK_MARKER,
    hooks: [{ type: 'command', command: `node "${NOTIFY_SCRIPT_PATH}"`, timeout: 5 }]
  }
  if (matcher) entry.matcher = matcher
  return entry
}

/** Strips every entry this app owns from a hooks map, in place. */
function stripOwnEntries(hooks: Record<string, unknown[]>): void {
  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue
    hooks[event] = hooks[event].filter(
      (e) => !(e && typeof e === 'object' && (e as Record<string, unknown>)._source === HOOK_MARKER)
    )
    if (hooks[event].length === 0) delete hooks[event]
  }
}

function readSettings(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    // corrupt settings — start fresh
    return {}
  }
}

/**
 * Removes hook registrations from a settings file, rewriting it only when
 * something actually changed so we never touch a file we do not own.
 */
function purgeFrom(settingsPath: string): void {
  if (!existsSync(settingsPath)) return
  try {
    const settings = readSettings(settingsPath)
    const hooks = settings.hooks as Record<string, unknown[]> | undefined
    if (!hooks) return
    const before = JSON.stringify(hooks)
    stripOwnEntries(hooks)
    if (JSON.stringify(hooks) === before) return
    if (Object.keys(hooks).length === 0) delete settings.hooks
    else settings.hooks = hooks
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  } catch {
    // ignore
  }
}

/**
 * Clears out the previous layout: entries in the committed settings.json and
 * the generated scripts under `.claude/hooks/`. Runs on every inject so
 * projects set up by an older version stop carrying our files around.
 */
function migrateLegacyProjectFiles(projectPath: string): void {
  purgeFrom(join(projectPath, '.claude', SHARED_SETTINGS))

  const legacyHooksDir = join(projectPath, '.claude', 'hooks')
  for (const name of ['multiterm-notify.cjs', 'multiterm-agent-viewer.cjs']) {
    try {
      unlinkSync(join(legacyHooksDir, name))
    } catch {
      // not there — nothing to do
    }
  }
  try {
    if (existsSync(legacyHooksDir) && readdirSync(legacyHooksDir).length === 0) {
      rmdirSync(legacyHooksDir)
    }
  } catch {
    // ignore
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

/** Writes the shared hook scripts into ~/.multiterm-studio/hooks. */
function installSharedScripts(): void {
  mkdirSync(SHARED_HOOKS_DIR, { recursive: true })
  writeFileSync(NOTIFY_SCRIPT_PATH, NOTIFY_SCRIPT, { mode: 0o755 })
  writeFileSync(join(SHARED_HOOKS_DIR, 'multiterm-agent-viewer.cjs'), VIEWER_SCRIPT, {
    mode: 0o755
  })
}

export async function injectHooks(projectPath: string): Promise<void> {
  installSharedScripts()
  migrateLegacyProjectFiles(projectPath)

  const settingsPath = join(projectPath, '.claude', LOCAL_SETTINGS)
  mkdirSync(join(projectPath, '.claude'), { recursive: true })

  const settings = readSettings(settingsPath)
  const hooks = (settings.hooks ?? {}) as Record<string, unknown[]>

  // Drop stale entries from a previous run before re-registering.
  stripOwnEntries(hooks)

  // SessionStart and SessionEnd — standard hooks
  for (const event of ['SessionStart', 'SessionEnd']) {
    if (!Array.isArray(hooks[event])) hooks[event] = []
    hooks[event].push(makeHookEntry())
  }

  // PostToolUse with Read|Write|Edit matcher — track file activity
  if (!Array.isArray(hooks['PostToolUse'])) hooks['PostToolUse'] = []
  hooks['PostToolUse'].push(makeHookEntry('Read|Write|Edit'))

  // PreToolUse with Agent matcher — detect agent spawning for panel creation
  if (!Array.isArray(hooks['PreToolUse'])) hooks['PreToolUse'] = []
  hooks['PreToolUse'].push(makeHookEntry('Agent'))

  settings.hooks = hooks
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
}

export async function removeHooks(projectPath: string): Promise<void> {
  // Both locations: the current one and anything an older version left behind.
  purgeFrom(join(projectPath, '.claude', LOCAL_SETTINGS))
  migrateLegacyProjectFiles(projectPath)
}

// --- OpenCode integration ---

const OPENCODE_PLUGIN_NAME = 'multiterm-studio.js'

const OPENCODE_PLUGIN_SCRIPT = `// multiterm-studio plugin for OpenCode
// Sends session and tool events to the Multiterm Studio RPC server
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

function readState(name) {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.multiterm-studio', name), 'utf-8').trim()
  } catch { return null }
}

function sendRpc(method, params) {
  const socketPath = readState('socket-path')
  const token = readState('socket-token')
  if (!socketPath || !token) return
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params, token }) + '\\n'
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

/**
 * Inject the multiterm-studio plugin into an OpenCode project.
 *
 * Unlike the Claude Code hooks, this one cannot live outside the project:
 * OpenCode only loads plugins from `<project>/.opencode/plugins`. It is
 * therefore added to the project's .gitignore so a generated file does not end
 * up in the user's commits.
 */
export async function injectOpenCodeHooks(projectPath: string): Promise<void> {
  if (!isOpenCodeAvailable()) return

  const pluginsDir = join(projectPath, '.opencode', 'plugins')
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true })
  }

  writeFileSync(join(pluginsDir, OPENCODE_PLUGIN_NAME), OPENCODE_PLUGIN_SCRIPT, { mode: 0o644 })
  ignoreGeneratedPlugin(projectPath)
}

/** Adds the generated OpenCode plugin to .gitignore, if the project has one. */
function ignoreGeneratedPlugin(projectPath: string): void {
  const gitignorePath = join(projectPath, '.gitignore')
  const entry = `.opencode/plugins/${OPENCODE_PLUGIN_NAME}`
  try {
    if (!existsSync(gitignorePath)) return
    const contents = readFileSync(gitignorePath, 'utf-8')
    // Already covered — either by this exact entry or by a broader rule.
    // Without this check every project open would append to the file again.
    if (contents.includes(entry) || /^\s*\.opencode\/?\s*$/m.test(contents)) return
    writeFileSync(
      gitignorePath,
      `${contents.replace(/\n*$/, '')}\n\n# Generated by Multiterm Studio\n${entry}\n`,
      'utf-8'
    )
  } catch {
    // best effort
  }
}

/** Remove the multiterm-studio plugin from an OpenCode project */
export async function removeOpenCodeHooks(projectPath: string): Promise<void> {
  const pluginPath = join(projectPath, '.opencode', 'plugins', OPENCODE_PLUGIN_NAME)
  try {
    unlinkSync(pluginPath)
  } catch {
    // ignore
  }

  // Clean up empty plugins dir (unlinkSync cannot remove a directory)
  const pluginsDir = join(projectPath, '.opencode', 'plugins')
  try {
    if (existsSync(pluginsDir) && readdirSync(pluginsDir).length === 0) {
      rmdirSync(pluginsDir)
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
\`~/.multiterm-studio/socket-path\`. Every request must include a \`token\`
field whose value is the contents of \`~/.multiterm-studio/socket-token\`;
requests without it are rejected and the connection is closed.

You can send notifications:

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
