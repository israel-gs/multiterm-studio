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
import {
  GOAL_READ_PERMISSION,
  installGoalServer,
  registerGoalServer,
  unregisterGoalServer
} from './goalMcpServer'

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
const STARTED_AT = Date.now()

// --- Run log ------------------------------------------------------------------
// A hook that fails does so in silence: Claude Code carries on and the user
// never learns why the goal stopped being injected. One line per firing gives
// the config panel something to show.

const LOG_PATH = path.join(os.homedir(), '.multiterm-studio', 'hook-log.jsonl')
const LOG_MAX_BYTES = 256 * 1024

function log(entry) {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    // Trimming only when it has actually grown keeps the common path a single
    // append.
    try {
      if (fs.statSync(LOG_PATH).size > LOG_MAX_BYTES) {
        const kept = fs.readFileSync(LOG_PATH, 'utf-8').split('\\n').slice(-200).join('\\n')
        fs.writeFileSync(LOG_PATH, kept)
      }
    } catch {}
    entry.at = STARTED_AT
    entry.ms = Date.now() - STARTED_AT
    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\\n')
  } catch {}
}

// --- Session goal ------------------------------------------------------------
// The goal reaches the model as hook output: plain stdout is added to context
// for UserPromptSubmit and SessionStart, and hookSpecificOutput.additionalContext
// carries it on PostToolUse — the one place a running turn can still be reached.
// Nothing here announces the goal to the user directly: that is Claude's job,
// asked for in the instructions below.

function findGoals(startDir) {
  let dir = startDir
  for (let i = 0; i < 12 && dir; i++) {
    try {
      const raw = fs.readFileSync(path.join(dir, '.multiterm', 'goals.json'), 'utf-8')
      return JSON.parse(raw)
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** The goal this terminal answers to: its own, or the project's. */
function hasContent(goal) {
  // A goal written as nothing but a checklist has no headline, and is still
  // a goal.
  return !!goal && (!!goal.text || ((goal.steps || []).length > 0))
}

function goalFor(cwd) {
  const goals = findGoals(cwd || process.cwd())
  if (!goals) return null
  const tileId = process.env.MULTITERM_PTY_SESSION_ID || ''
  const tile = tileId && goals.tiles ? goals.tiles[tileId] : null
  const project = goals.project || null

  let goal
  if (hasContent(tile)) {
    goal = tile
  } else if (tile && tile.proposal) {
    // The tile holds nothing but a pending proposal, so the objective in force
    // is still the project's — but the proposal has to travel with it, or the
    // agent would never learn that its own request is waiting on the user.
    goal = hasContent(project)
      ? Object.assign({}, project, { proposal: tile.proposal, rejection: tile.rejection })
      : tile
  } else {
    goal = project
  }

  if (!hasContent(goal) && !(goal && goal.proposal) && !(goal && goal.rejection)) return null
  // A finished goal has nothing to steer; injecting it would only invite the
  // agent to re-do work the user already signed off.
  if (goal.status === 'done') return null
  return goal
}

function renderGoal(goal) {
  const steps = goal.steps || []
  let out = goal.text
    ? 'Objective: ' + goal.text
    : (steps.length ? 'Objective: work through the checklist below.' : 'No objective set yet.')
  if (steps.length) {
    const done = steps.filter(s => s.done).length
    out += '\\nChecklist (' + done + '/' + steps.length + ' done):'
    steps.forEach((s, i) => {
      out += '\\n  ' + (i + 1) + '. [' + (s.done ? 'x' : ' ') + '] ' + s.text
    })
  }
  return out
}

const TOOLING =
  'You have MCP tools for this goal: goal_get (re-read it), goal_step_done (tick a step as you ' +
  'finish it), goal_complete (only when the objective is genuinely met), and goal_set (ask for a ' +
  'different objective, with a reason). The last two only *propose*: the user accepts or rejects ' +
  'in the app, and you are told the outcome here. Use them rather than asking in prose.'

/** A proposal the user has not answered yet, restated so it is not forgotten. */
function pendingBlock(goal) {
  const p = goal.proposal
  const what = p.kind === 'complete'
    ? 'that this goal is met' + (p.summary ? ' — "' + p.summary + '"' : '')
    : 'to change the objective to "' + (p.text || '') + '"' + (p.reason ? ' because ' + p.reason : '')
  return '<session-goal-proposal>\\n' +
    'You proposed ' + what + '. The user has not answered yet, so nothing has changed. ' +
    'Do not act as though it were accepted, and do not propose it again.\\n' +
    '</session-goal-proposal>\\n'
}

function rejectionBlock(goal) {
  const kind = goal.rejection.kind === 'complete'
    ? 'that the goal was met'
    : 'your change of objective'
  return '<session-goal-rejected>\\n' +
    'The user rejected ' + kind + '. The objective below still stands — ask them what is ' +
    'missing rather than proposing the same thing again.\\n' +
    renderGoal(goal) + '\\n</session-goal-rejected>\\n'
}

function openingBlock(goal) {
  return '<session-goal>\\n' + renderGoal(goal) + '\\n</session-goal>\\n' +
    'This is what the user set this terminal to work towards. Open your first reply by stating ' +
    'the objective in one short line, so they can see what you are steering by. ' +
    'If a request would not advance it, say so and ask before doing the work. ' + TOOLING + '\\n'
}

function turnBlock(goal) {
  return '<session-goal>\\n' + renderGoal(goal) + '\\n</session-goal>\\n' +
    'If this request does not advance the objective, say so before acting on it.\\n'
}

function changeBlock(goal, previousText) {
  return '<session-goal-changed>\\n' +
    'The user changed this terminal\\'s objective mid-session.\\n' +
    (previousText ? 'Previous: ' + previousText + '\\n' : '') +
    renderGoal(goal) + '\\n</session-goal-changed>\\n' +
    'Acknowledge the change in one line, then work towards the new objective. ' +
    'If what you are doing right now no longer serves it, stop and say so.\\n'
}

// What this session was last told, so a change can be announced as a change.
// Session state, so it lives in the app's directory rather than the project's.
function seenPath(sessionId) {
  return path.join(os.homedir(), '.multiterm-studio', 'goal-seen', sessionId + '.json')
}

function readSeen(sessionId) {
  try { return JSON.parse(fs.readFileSync(seenPath(sessionId), 'utf-8')) } catch { return null }
}

function writeSeen(sessionId, goal) {
  try {
    const p = seenPath(sessionId)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const steps = goal.steps || []
    const headline = goal.text || (steps[0] && steps[0].text) || ''
    fs.writeFileSync(p, JSON.stringify({
      updatedAt: goal.updatedAt || 0,
      text: headline,
      rejectionAt: (goal.rejection && goal.rejection.at) || 0
    }))
  } catch {}
}

let input = ''
process.stdin.on('data', c => input += c)
process.stdin.on('end', () => {
  let data
  try { data = JSON.parse(input) } catch {
    log({ event: 'unknown', error: 'stdin was not JSON' })
    process.exit(0)
  }
  const event = data.hook_event_name
  const sessionId = data.session_id || ''
  const tool = data.tool_name || undefined
  let injected = false

  // Injecting the goal must not depend on the app being reachable: the socket
  // may be gone while the terminal (and its agent) is still running.
  if (event === 'SessionStart' || event === 'UserPromptSubmit' || event === 'PostToolUse') {
    try {
      const goal = goalFor(data.cwd)
      if (goal) {
        const seen = sessionId ? readSeen(sessionId) : null
        const changed = seen && (goal.updatedAt || 0) > (seen.updatedAt || 0)
        const rejected = goal.rejection &&
          (!seen || (goal.rejection.at || 0) > (seen.rejectionAt || 0))
        let block = null

        if (rejected) {
          // A verdict the agent is waiting on outranks the routine restatement.
          block = rejectionBlock(goal)
        } else if (changed) {
          // Reaches a turn already in flight, next to a tool result.
          block = changeBlock(goal, seen.text)
        } else if (goal.proposal) {
          block = pendingBlock(goal)
          // Only worth saying alongside a prompt or a fresh session; repeating
          // it after every tool call would drown the turn.
          if (event === 'PostToolUse') block = null
          else if (event === 'SessionStart') block = openingBlock(goal) + block
        } else if (event === 'SessionStart') {
          block = openingBlock(goal)
        } else if (event === 'UserPromptSubmit') {
          block = turnBlock(goal)
        }

        if (block) {
          if (event === 'PostToolUse') {
            process.stdout.write(JSON.stringify({
              hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: block }
            }) + '\\n')
          } else {
            process.stdout.write(block)
          }
          injected = true
          if (sessionId) writeSeen(sessionId, goal)
        } else if (sessionId && !seen) {
          writeSeen(sessionId, goal)
        }
      }
    } catch (err) {
      log({ event, tool, error: 'goal injection failed: ' + ((err && err.message) || err) })
    }
    if (event === 'UserPromptSubmit') {
      log({ event, tool, injected })
      process.exit(0)
    }
  }

  const stateDir = path.join(os.homedir(), '.multiterm-studio')
  let socketPath, token
  try { socketPath = fs.readFileSync(path.join(stateDir, 'socket-path'), 'utf-8').trim() } catch {
    log({ event, tool, injected, error: 'Multiterm is not running' })
    process.exit(0)
  }
  try { token = fs.readFileSync(path.join(stateDir, 'socket-token'), 'utf-8').trim() } catch {
    log({ event, tool, injected, error: 'no socket token' })
    process.exit(0)
  }
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
      if (data.tool_name !== 'Agent') {
        log({ event, tool, injected })
        process.exit(0)
      }
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
      log({ event, tool, injected })
      process.exit(0)
  }
  const msg = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params, token }) + '\\n'
  const client = net.createConnection(socketPath, () => {
    client.write(msg)
    client.end()
    log({ event, tool, injected })
  })
  client.on('error', (err) => {
    log({ event, tool, injected, error: 'socket: ' + ((err && err.message) || err) })
    process.exit(0)
  })
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

/**
 * Strips every entry this app owns from a hooks map, in place.
 *
 * Ownership is recognised two ways on purpose. The `_source` marker is ours,
 * but it does not always survive: another writer that rewrites the settings
 * file can normalise the entry and drop the key it does not know. When that
 * happened the next inject no longer recognised its own entry and appended a
 * second one, so every hook fired twice — invisibly, since a duplicate hook
 * just does the same work again. Matching the command path as well makes the
 * clean-up idempotent whatever the file has been through.
 */
function stripOwnEntries(hooks: Record<string, unknown[]>): void {
  const isOurs = (entry: unknown): boolean => {
    if (!entry || typeof entry !== 'object') return false
    const record = entry as Record<string, unknown>
    if (record._source === HOOK_MARKER) return true
    const commands = Array.isArray(record.hooks) ? record.hooks : []
    return (
      commands.length > 0 &&
      commands.every(
        (command) =>
          command &&
          typeof command === 'object' &&
          String((command as Record<string, unknown>).command ?? '').includes(NOTIFY_SCRIPT_PATH)
      )
    )
  }

  for (const event of Object.keys(hooks)) {
    if (!Array.isArray(hooks[event])) continue
    hooks[event] = hooks[event].filter((entry) => !isOurs(entry))
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

  // SessionStart also re-injects the goal after a compaction or a --resume,
  // which is exactly where the original objective used to get dropped.
  // UserPromptSubmit re-states it on every turn.
  for (const event of ['SessionStart', 'SessionEnd', 'UserPromptSubmit']) {
    if (!Array.isArray(hooks[event])) hooks[event] = []
    hooks[event].push(makeHookEntry())
  }

  // PostToolUse tracks file activity, and is also the only way to reach a turn
  // that is already running — which is how a goal changed mid-turn lands. Bash
  // is in the matcher for that second reason, not the first.
  if (!Array.isArray(hooks['PostToolUse'])) hooks['PostToolUse'] = []
  hooks['PostToolUse'].push(makeHookEntry('Read|Write|Edit|Bash'))

  // PreToolUse with Agent matcher — detect agent spawning for panel creation
  if (!Array.isArray(hooks['PreToolUse'])) hooks['PreToolUse'] = []
  hooks['PreToolUse'].push(makeHookEntry('Agent'))

  settings.hooks = hooks
  allowGoalRead(settings)
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')

  // Goal tools. Reading the goal is pre-approved above; changing or closing it
  // deliberately is not, so Claude Code asks the user first.
  installGoalServer()
  registerGoalServer(projectPath)
  ignoreGeneratedFile(projectPath, '.mcp.json')
}

/**
 * Pre-approves the read-only goal tool.
 *
 * Without this the agent gets a permission prompt just for looking up what it
 * is supposed to be doing, which is exactly the interruption the goal is meant
 * to avoid. The three tools that write are left to prompt.
 */
function allowGoalRead(settings: Record<string, unknown>): void {
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>
  const allow = Array.isArray(permissions.allow) ? (permissions.allow as string[]) : []
  if (!allow.includes(GOAL_READ_PERMISSION)) allow.push(GOAL_READ_PERMISSION)
  permissions.allow = allow
  settings.permissions = permissions
}

export async function removeHooks(projectPath: string): Promise<void> {
  // Both locations: the current one and anything an older version left behind.
  purgeFrom(join(projectPath, '.claude', LOCAL_SETTINGS))
  migrateLegacyProjectFiles(projectPath)
  revokeGoalRead(join(projectPath, '.claude', LOCAL_SETTINGS))
  unregisterGoalServer(projectPath)
}

/** Takes back the pre-approval, leaving the user's own rules untouched. */
function revokeGoalRead(settingsPath: string): void {
  if (!existsSync(settingsPath)) return
  try {
    const settings = readSettings(settingsPath)
    const permissions = settings.permissions as Record<string, unknown> | undefined
    if (!permissions || !Array.isArray(permissions.allow)) return
    const allow = permissions.allow as string[]
    if (!allow.includes(GOAL_READ_PERMISSION)) return

    // Only our own rule goes. The surrounding structure may predate us — an
    // empty `allow: []` the user wrote is theirs to keep.
    permissions.allow = allow.filter((rule) => rule !== GOAL_READ_PERMISSION)
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  } catch {
    // ignore
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
  ignoreGeneratedFile(
    projectPath,
    `.opencode/plugins/${OPENCODE_PLUGIN_NAME}`,
    /^\s*\.opencode\/?\s*$/m
  )
}

/**
 * Adds a file this app generates to .gitignore, if the project has one.
 *
 * `broaderRule` recognises an existing rule that already covers the entry, so
 * a project that ignores a whole directory is left alone instead of collecting
 * a redundant line on every open.
 */
function ignoreGeneratedFile(projectPath: string, entry: string, broaderRule?: RegExp): void {
  const gitignorePath = join(projectPath, '.gitignore')
  try {
    if (!existsSync(gitignorePath)) return
    const contents = readFileSync(gitignorePath, 'utf-8')
    if (contents.includes(entry)) return
    if (broaderRule && broaderRule.test(contents)) return
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
