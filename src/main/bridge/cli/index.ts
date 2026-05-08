/**
 * multiterm CLI — pure logic module.
 *
 * Exported `run(argv, env, deps)` so that tests can inject mocked deps and
 * call the function directly without touching a real socket or process.exit.
 *
 * The production entry point (`entry.ts`) calls `run` with real deps and exits.
 */

import { ERROR_CODES, BRIDGE_CONTROL_ENDPOINT } from '../protocol'

// ── Dep injection interface ───────────────────────────────────────────────────

export interface CliDeps {
  /** Open a connection to the bridge daemon. Rejects with ECONNREFUSED etc. */
  connect: (endpoint: string) => Promise<void>
  /** Send one JSON-RPC request and return the result, or throw { code, message }. */
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>
  /** Write to stdout. */
  log: (msg: string) => void
  /** Write to stderr. */
  errlog: (msg: string) => void
}

// ── Exit codes ────────────────────────────────────────────────────────────────

const EXIT = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  NO_DAEMON: 3,
  DISABLED: 4,
  NOT_FOUND: 5,
  DECLINED: 6,
  TIMEOUT: 7
} as const

// ── Error code → exit code mapping ────────────────────────────────────────────

function bridgeErrorToExit(code: number): number {
  switch (code) {
    case ERROR_CODES.BridgeDisabled:
      return EXIT.DISABLED
    case ERROR_CODES.BridgeShutdown:
      return EXIT.NO_DAEMON
    case ERROR_CODES.PaneNotFound:
    case ERROR_CODES.TaskNotFound:
    case ERROR_CODES.KVKeyInvalid:
      return EXIT.NOT_FOUND
    case ERROR_CODES.DeclinedByUser:
      return EXIT.DECLINED
    case ERROR_CODES.Timeout:
      return EXIT.TIMEOUT
    default:
      return EXIT.GENERIC
  }
}

// ── Usage strings ─────────────────────────────────────────────────────────────

const USAGE = {
  root: `Usage: multiterm <subcommand> [args] [--json]

Subcommands:
  send-to <target> <message>       Send a message to a pane (blocking)
  notify  <target> <message>       Send a fire-and-forget notification
  task    create|claim|complete|release|list [args]
  kv      set|get|del|list [args]
  agent   list|alias [args]
  help    [subcommand]             Print usage
  version                          Print version

Must run inside a Multiterm pane (MULTITERM_PANE_ID must be set),
except for help and version.`,

  sendTo: `Usage: multiterm send-to <target> <message> [--json]

  target   Pane id or @alias
  message  Text to send`,

  notify: `Usage: multiterm notify <target> <message> [--json]`,

  task: `Usage: multiterm task <action> [args] [--json]

  create <name> [body]              Create a new task (positional form)
  create --name <n> [--body <b>]    Same, with named flags
  claim    <taskId>                 Claim a task
  complete <taskId>                 Complete a task you own
  release  <taskId>                 Release a task back to the pool
  list [--status <s>] [--owned-by <p>]   List tasks (filterable)`,

  kv: `Usage: multiterm kv <action> [args] [--json]

  set <key> <value>   Store a value
  get <key>           Retrieve a value
  del <key>           Delete a key
  list [prefix] | list --prefix <p>   List keys (optional prefix filter)`,

  agent: `Usage: multiterm agent <action> [args] [--json]

  list                List active panes
  alias @<name>       Set an alias for this pane (e.g. @reviewer)`
}

// ── Output formatter ──────────────────────────────────────────────────────────

/**
 * Parse a flat argv slice into named flags and positional args.
 * Recognizes `--key value` and `--key=value`. Repeated flags overwrite.
 * Stops flag parsing at `--` and treats the rest as positional.
 */
function parseFlags(args: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>()
  const positional: string[] = []
  let i = 0
  while (i < args.length) {
    const a = args[i]
    if (a === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq !== -1) {
        flags.set(a.slice(2, eq), a.slice(eq + 1))
        i++
        continue
      }
      const key = a.slice(2)
      const next = args[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next)
        i += 2
        continue
      }
      // boolean flag with no value
      flags.set(key, 'true')
      i++
      continue
    }
    positional.push(a)
    i++
  }
  return { flags, positional }
}

function formatResult(result: unknown, json: boolean): string {
  if (json) return JSON.stringify(result)

  if (typeof result === 'string') return result
  if (Array.isArray(result)) {
    if (result.length === 0) return '(none)'
    return result.map((r) => JSON.stringify(r)).join('\n')
  }
  if (result !== null && typeof result === 'object') {
    return JSON.stringify(result)
  }
  return String(result)
}

// ── Subcommand handlers ───────────────────────────────────────────────────────

async function cmdSendTo(
  args: string[],
  from: string,
  json: boolean,
  deps: CliDeps
): Promise<number> {
  const { flags, positional } = parseFlags(args)
  const [to, body] = positional
  if (!to || !body) {
    deps.errlog('Usage: multiterm send-to <target> <message> [--timeout <ms>]')
    return EXIT.USAGE
  }
  const params: Record<string, unknown> = { from, to, body }
  const timeout = flags.get('timeout')
  if (timeout) {
    const n = Number(timeout)
    if (Number.isFinite(n) && n > 0) params.timeoutMs = n
  }
  const result = await deps.call('bridge.send', params)
  deps.log(formatResult(result, json))
  return EXIT.OK
}

async function cmdNotify(
  args: string[],
  from: string,
  json: boolean,
  deps: CliDeps
): Promise<number> {
  const { positional } = parseFlags(args)
  const [to, body] = positional
  if (!to || !body) {
    deps.errlog('Usage: multiterm notify <target> <message>')
    return EXIT.USAGE
  }
  const result = await deps.call('bridge.notify', { from, to, body })
  deps.log(formatResult(result, json))
  return EXIT.OK
}

async function cmdTask(
  args: string[],
  from: string,
  json: boolean,
  deps: CliDeps
): Promise<number> {
  const [action, ...rest] = args
  switch (action) {
    case 'create': {
      const { flags, positional } = parseFlags(rest)
      const name = flags.get('name') ?? positional[0]
      const body = flags.get('body') ?? positional[1]
      if (!name) {
        deps.errlog(
          'Usage: multiterm task create <name> [body]\n       multiterm task create --name <name> [--body <body>]'
        )
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.task.create', { from, name, body })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'claim': {
      const [taskId] = rest
      if (!taskId) {
        deps.errlog('Usage: multiterm task claim <taskId>')
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.task.claim', { from, taskId })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'complete': {
      const [taskId] = rest
      if (!taskId) {
        deps.errlog('Usage: multiterm task complete <taskId>')
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.task.complete', { from, taskId })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'release': {
      const [taskId] = rest
      if (!taskId) {
        deps.errlog('Usage: multiterm task release <taskId>')
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.task.release', { from, taskId })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'list': {
      const { flags } = parseFlags(rest)
      const params: Record<string, unknown> = { from }
      const status = flags.get('status')
      if (status) params.status = status
      const ownedBy = flags.get('owned-by')
      if (ownedBy) params.ownedBy = ownedBy
      const result = await deps.call('bridge.task.list', params)
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    default:
      deps.errlog(USAGE.task)
      return EXIT.USAGE
  }
}

async function cmdKv(args: string[], from: string, json: boolean, deps: CliDeps): Promise<number> {
  const [action, ...rest] = args
  switch (action) {
    case 'set': {
      const [key, value] = rest
      if (!key || value === undefined) {
        deps.errlog('Usage: multiterm kv set <key> <value>')
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.kv.set', { from, key, value })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'get': {
      const [key] = rest
      if (!key) {
        deps.errlog('Usage: multiterm kv get <key>')
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.kv.get', { from, key })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'del': {
      const [key] = rest
      if (!key) {
        deps.errlog('Usage: multiterm kv del <key>')
        return EXIT.USAGE
      }
      const result = await deps.call('bridge.kv.del', { from, key })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'list': {
      const { flags, positional } = parseFlags(rest)
      const prefix = flags.get('prefix') ?? positional[0]
      const params: Record<string, unknown> = { from }
      if (prefix) params.prefix = prefix
      const result = await deps.call('bridge.kv.list', params)
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    default:
      deps.errlog(USAGE.kv)
      return EXIT.USAGE
  }
}

async function cmdAgent(
  args: string[],
  from: string,
  json: boolean,
  deps: CliDeps
): Promise<number> {
  const [action, ...rest] = args
  switch (action) {
    case 'list': {
      const result = await deps.call('bridge.agent.list', { from })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    case 'alias': {
      const [arg] = rest
      if (!arg) {
        deps.errlog('Usage: multiterm agent alias @<name>')
        return EXIT.USAGE
      }
      // Per spec: the @ prefix is mandatory in the CLI; the bridge stores
      // the alias without the prefix. Strip it before sending.
      if (!arg.startsWith('@')) {
        deps.errlog('Alias must be prefixed with @ (e.g. @reviewer)')
        return EXIT.USAGE
      }
      const alias = arg.slice(1)
      const result = await deps.call('bridge.agent.alias', { from, alias })
      deps.log(formatResult(result, json))
      return EXIT.OK
    }
    default:
      deps.errlog(USAGE.agent)
      return EXIT.USAGE
  }
}

// ── Identity check ────────────────────────────────────────────────────────────

/** Subcommands that do NOT require MULTITERM_PANE_ID. */
const NO_ID_ALLOWED = new Set(['help', 'version', '--help', '-h'])

// ── Main entry ────────────────────────────────────────────────────────────────

/**
 * Pure run function. Returns the intended process exit code (0–7).
 * The caller (entry.ts or tests) is responsible for calling process.exit.
 *
 * `deps.connect` and `deps.call` are injected so tests can mock the socket.
 */
export async function run(argv: string[], env: NodeJS.ProcessEnv, deps: CliDeps): Promise<number> {
  // Strip global flags before routing
  const json = argv.includes('--json')
  const args = argv.filter((a) => a !== '--json')

  const [sub, ...rest] = args

  // ── help / version (no identity required) ────────────────────────────────

  if (!sub || sub === '--help' || sub === '-h') {
    deps.log(USAGE.root)
    return EXIT.USAGE
  }

  if (sub === 'help') {
    const topic = rest[0]
    const usageMap: Record<string, string> = {
      'send-to': USAGE.sendTo,
      notify: USAGE.notify,
      task: USAGE.task,
      kv: USAGE.kv,
      agent: USAGE.agent
    }
    deps.log(topic && usageMap[topic] ? usageMap[topic] : USAGE.root)
    return EXIT.OK
  }

  if (sub === 'version') {
    // Version is embedded at build time; fall back gracefully in dev.
    deps.log('multiterm 0.0.0-dev')
    return EXIT.OK
  }

  // ── Unknown subcommand ────────────────────────────────────────────────────

  const KNOWN = new Set(['send-to', 'notify', 'task', 'kv', 'agent'])
  if (!KNOWN.has(sub)) {
    deps.errlog(`Unknown subcommand: ${sub}`)
    deps.errlog(USAGE.root)
    return EXIT.USAGE
  }

  // ── Identity check ────────────────────────────────────────────────────────

  const from = env.MULTITERM_PANE_ID
  if (!from && !NO_ID_ALLOWED.has(sub)) {
    deps.errlog('MULTITERM_PANE_ID is not set. This command must run inside a Multiterm pane.')
    return EXIT.USAGE
  }

  // ── Connect to daemon ─────────────────────────────────────────────────────

  try {
    await deps.connect(BRIDGE_CONTROL_ENDPOINT)
  } catch (err: unknown) {
    const e = err as { code?: string }
    if (e?.code === 'ECONNREFUSED' || e?.code === 'ENOENT') {
      deps.errlog('Bridge daemon is not running. Start Multiterm Studio and try again.')
      return EXIT.NO_DAEMON
    }
    deps.errlog(`Connection error: ${String(err)}`)
    return EXIT.NO_DAEMON
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  try {
    switch (sub) {
      case 'send-to':
        return await cmdSendTo(rest, from!, json, deps)
      case 'notify':
        return await cmdNotify(rest, from!, json, deps)
      case 'task':
        return await cmdTask(rest, from!, json, deps)
      case 'kv':
        return await cmdKv(rest, from!, json, deps)
      case 'agent':
        return await cmdAgent(rest, from!, json, deps)
      default:
        deps.errlog(`Unknown subcommand: ${sub}`)
        return EXIT.USAGE
    }
  } catch (err: unknown) {
    const e = err as { code?: number; message?: string }
    if (typeof e?.code === 'number') {
      // JSON-RPC error from the bridge
      if (e.message) deps.errlog(`Error: ${e.message}`)
      return bridgeErrorToExit(e.code)
    }
    deps.errlog(`Unexpected error: ${String(err)}`)
    return EXIT.GENERIC
  }
}
