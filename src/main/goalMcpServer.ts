import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

/**
 * Multiterm gives the agent real tools over MCP rather than asking it to emit
 * markers in its prose. The reason is the permission system: a tool call that
 * is not on the allowlist stops and asks the user, so "the agent proposes, you
 * confirm" needs no machinery of its own — closing a goal or rewriting it
 * simply prompts.
 */
const MCP_DIR = join(homedir(), '.multiterm-studio', 'mcp')
export const GOAL_SERVER_PATH = join(MCP_DIR, 'multiterm-goals.cjs')

/** Key under `mcpServers`, and the middle part of every tool's callable name. */
export const GOAL_SERVER_NAME = 'multiterm-goals'

/** Reading the goal is harmless, so it runs without interrupting the user. */
export const GOAL_READ_PERMISSION = `mcp__${GOAL_SERVER_NAME}__goal_get`

const SERVER_SCRIPT = `#!/usr/bin/env node
// Multiterm Studio — session goal tools (MCP stdio server).
// Generated file: edits are overwritten when the app next opens a project.
const fs = require('fs'), net = require('net'), os = require('os'), path = require('path')

// --- Goal storage (mirrors src/main/sessionGoal.ts) --------------------------

function findProjectRoot(startDir) {
  let dir = startDir
  for (let i = 0; i < 12 && dir; i++) {
    if (fs.existsSync(path.join(dir, '.multiterm'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

const ROOT = findProjectRoot(process.cwd())
const GOALS_PATH = path.join(ROOT, '.multiterm', 'goals.json')
const TILE_ID = process.env.MULTITERM_PTY_SESSION_ID || ''

function loadGoals() {
  try {
    const parsed = JSON.parse(fs.readFileSync(GOALS_PATH, 'utf-8'))
    return { project: parsed.project || null, tiles: parsed.tiles || {} }
  } catch { return { project: null, tiles: {} } }
}

function saveGoals(goals) {
  const tmp = GOALS_PATH + '.' + process.pid + '.tmp'
  fs.mkdirSync(path.dirname(GOALS_PATH), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(goals, null, 2), 'utf-8')
  fs.renameSync(tmp, GOALS_PATH)
  notifyApp()
}

/**
 * The app is showing this file in its goals panel, so it has to hear about a
 * write that did not come from the UI. Best effort: the tools still work with
 * the app closed, the panel just refreshes later.
 */
function notifyApp() {
  try {
    const stateDir = path.join(os.homedir(), '.multiterm-studio')
    const socketPath = fs.readFileSync(path.join(stateDir, 'socket-path'), 'utf-8').trim()
    const token = fs.readFileSync(path.join(stateDir, 'socket-token'), 'utf-8').trim()
    const msg = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'goals.changed', token,
      params: { folder_path: ROOT, pty_session_id: TILE_ID }
    }) + '\\n'
    const client = net.createConnection(socketPath, () => { client.write(msg); client.end() })
    client.on('error', () => {})
  } catch {}
}

// A goal written as nothing but a checklist has no headline, and is still a goal.
function hasContent(goal) {
  return !!goal && (!!goal.text || (goal.steps || []).length > 0)
}

/** Which goal this terminal answers to: its own, or the project's. */
function currentScope() {
  const goals = loadGoals()
  if (TILE_ID && hasContent(goals.tiles[TILE_ID])) {
    return { goals, tileId: TILE_ID, goal: goals.tiles[TILE_ID] }
  }
  return { goals, tileId: null, goal: hasContent(goals.project) ? goals.project : null }
}

function writeScope(goals, tileId, goal) {
  if (tileId === null) goals.project = goal
  else goals.tiles[tileId] = goal
  saveGoals(goals)
}

function describe(goal, inherited) {
  if (!goal) return { has_goal: false }
  return {
    has_goal: true,
    goal: goal.text || 'Work through the checklist.',
    steps: (goal.steps || []).map((s, i) => ({ number: i + 1, text: s.text, done: !!s.done })),
    status: goal.status || 'active',
    scope: inherited ? 'project' : 'this terminal',
    set_at: goal.updatedAt ? new Date(goal.updatedAt).toISOString() : null
  }
}

// --- Tools -------------------------------------------------------------------

const TOOLS = [
  {
    name: 'goal_get',
    description:
      'Read the session goal this terminal is working towards, with its checklist and status. ' +
      'Call it when you are unsure whether a request still serves the goal.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'goal_complete',
    description:
      'Mark the current goal as met. Call this only when the work is actually finished; ' +
      'the user is asked to approve, and your summary is what they see.',
    inputSchema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'One line on what was accomplished.' } },
      required: ['summary'],
      additionalProperties: false
    }
  },
  {
    name: 'goal_step_done',
    description: 'Tick one step of the goal checklist, by its number as returned by goal_get.',
    inputSchema: {
      type: 'object',
      properties: { step: { type: 'number', description: '1-based step number.' } },
      required: ['step'],
      additionalProperties: false
    }
  },
  {
    name: 'goal_set',
    description:
      'Replace the goal of this terminal. Use it when the work has genuinely moved on, ' +
      'and say why — the user approves the change before it takes effect. ' +
      'Bullet lines starting with "-" become checklist steps.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The new goal. Bullet lines become steps.' },
        reason: { type: 'string', description: 'Why the goal should change.' }
      },
      required: ['text', 'reason'],
      additionalProperties: false
    }
  }
]

function parseGoalInput(raw) {
  const headline = [], steps = []
  for (const line of String(raw).split('\\n')) {
    const bullet = /^\\s*[-*]\\s+(.*)$/.exec(line)
    if (bullet) {
      const text = bullet[1].replace(/^\\[[ xX]\\]\\s*/, '').trim()
      if (text) steps.push({ text, done: /^\\[[xX]\\]/.test(bullet[1]) })
    } else if (line.trim()) headline.push(line.trim())
  }
  return { text: headline.join(' ').slice(0, 2000), steps }
}

function callTool(name, args) {
  if (name === 'goal_get') {
    const { goal, tileId } = currentScope()
    return describe(goal, tileId === null)
  }

  if (name === 'goal_complete') {
    const { goals, tileId, goal } = currentScope()
    if (!goal) return { ok: false, error: 'No goal is set for this terminal.' }
    if (goal.status === 'done') return { ok: false, error: 'This goal is already closed.' }
    writeScope(goals, tileId, Object.assign({}, goal, {
      proposal: { kind: 'complete', summary: String(args.summary || '').trim(), at: Date.now() }
    }))
    return {
      ok: true,
      status: 'awaiting_user',
      message:
        'Proposed to the user, who has not decided yet. The goal is still open. ' +
        'Do not treat it as met, and do not call goal_complete again — you will be ' +
        'told the answer.'
    }
  }

  if (name === 'goal_step_done') {
    const { goals, tileId, goal } = currentScope()
    if (!goal) return { ok: false, error: 'No goal is set for this terminal.' }
    const index = Number(args.step) - 1
    const steps = goal.steps || []
    if (!(index >= 0 && index < steps.length)) {
      return { ok: false, error: 'Step ' + args.step + ' does not exist; this goal has ' + steps.length + '.' }
    }
    const next = steps.map((s, i) => i === index ? Object.assign({}, s, { done: true }) : s)
    writeScope(goals, tileId, Object.assign({}, goal, { steps: next }))
    const remaining = next.filter(s => !s.done).length
    return {
      ok: true,
      step: steps[index].text,
      remaining,
      // Ticking the last box does not close anything: only the user does, and
      // they only get asked if goal_complete is called.
      note: remaining === 0
        ? 'Every step is ticked, but the goal is still open. If the objective is ' +
          'genuinely met, call goal_complete — the user decides.'
        : undefined
    }
  }

  if (name === 'goal_set') {
    const { goals, tileId, goal } = currentScope()
    const parsed = parseGoalInput(args.text)
    if (!parsed.text && !parsed.steps.length) return { ok: false, error: 'The new goal is empty.' }

    const proposal = {
      kind: 'change',
      text: parsed.text,
      steps: parsed.steps,
      reason: String(args.reason || '').trim(),
      at: Date.now()
    }

    // The proposal always attaches to this terminal, never to the project goal
    // it may be inheriting: one agent must not redirect the others. Accepting
    // it gives this terminal its own objective and leaves the project's alone.
    const target = TILE_ID || null
    const existing = target ? goals.tiles[target] : goals.project
    writeScope(
      goals,
      target,
      existing
        ? Object.assign({}, existing, { proposal })
        : { text: '', steps: [], status: 'active', updatedAt: Date.now(), proposal }
    )
    return {
      ok: true,
      status: 'awaiting_user',
      message:
        'Proposed to the user, who has not decided yet. The current objective still ' +
        'stands until they accept. You will be told the answer.'
    }
  }

  return { ok: false, error: 'Unknown tool: ' + name }
}

// --- MCP stdio transport (newline-delimited JSON-RPC) ------------------------

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\\n') }

function handle(msg) {
  const { id, method, params } = msg

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: (params && params.protocolVersion) || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'multiterm-goals', version: '1.0.0' }
      }
    })
    return
  }

  if (method === 'tools/list') { send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return }

  if (method === 'tools/call') {
    const name = params && params.name
    let result
    try { result = callTool(name, (params && params.arguments) || {}) }
    catch (err) { result = { ok: false, error: String((err && err.message) || err) } }
    send({
      jsonrpc: '2.0', id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: result && result.ok === false
      }
    })
    return
  }

  if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return }

  // Notifications carry no id and expect no reply.
  if (id === undefined || id === null) return

  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } })
}

let buffer = ''
process.stdin.setEncoding('utf-8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let idx
  while ((idx = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)
    if (!line) continue
    try { handle(JSON.parse(line)) } catch {}
  }
})
process.stdin.on('end', () => process.exit(0))
`

/** Writes the MCP server script into the app's own state directory. */
export function installGoalServer(): void {
  mkdirSync(MCP_DIR, { recursive: true })
  writeFileSync(GOAL_SERVER_PATH, SERVER_SCRIPT, { mode: 0o755 })
}

interface McpConfig {
  mcpServers?: Record<string, unknown>
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

/**
 * Registers the server in the project's `.mcp.json`.
 *
 * `~/.claude.json` would keep the checkout clean, but Claude Code rewrites that
 * file throughout a session and a concurrent write would lose whatever it was
 * holding. `.mcp.json` is ours to edit, and is added to .gitignore the same way
 * the generated OpenCode plugin is.
 */
export function registerGoalServer(projectPath: string): void {
  const configPath = join(projectPath, '.mcp.json')
  const config = readJson(configPath) as McpConfig
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>

  const entry = {
    type: 'stdio',
    command: 'node',
    args: [GOAL_SERVER_PATH],
    env: {}
  }

  // Rewriting an unchanged file on every project open would churn its mtime
  // and, worse, re-trigger Claude Code's approval prompt.
  if (JSON.stringify(servers[GOAL_SERVER_NAME]) === JSON.stringify(entry)) return

  servers[GOAL_SERVER_NAME] = entry
  config.mcpServers = servers
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/** Removes the registration, leaving any server the user added in place. */
export function unregisterGoalServer(projectPath: string): void {
  const configPath = join(projectPath, '.mcp.json')
  if (!existsSync(configPath)) return
  const config = readJson(configPath) as McpConfig
  if (!config.mcpServers || !(GOAL_SERVER_NAME in config.mcpServers)) return

  delete config.mcpServers[GOAL_SERVER_NAME]
  if (Object.keys(config.mcpServers).length === 0) delete config.mcpServers

  // The file existed only for us — take it with us rather than leave `{}`.
  if (Object.keys(config).length === 0) {
    try {
      unlinkSync(configPath)
    } catch {
      /* ignore */
    }
    return
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}
