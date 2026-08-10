/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'

/**
 * The MCP server is a generated script, so the only meaningful test is to speak
 * the protocol to it the way Claude Code does: newline-delimited JSON-RPC on
 * stdio, and the goals file on disk as the observable result.
 */

let home: string
let project: string

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => process.env.MTS_TEST_HOME! }
})

const goalsFile = (): string => join(project, '.multiterm', 'goals.json')

function writeGoals(goals: unknown): void {
  mkdirSync(join(project, '.multiterm'), { recursive: true })
  writeFileSync(goalsFile(), JSON.stringify(goals))
}

function readGoals(): { project: unknown; tiles: Record<string, Record<string, unknown>> } {
  return JSON.parse(readFileSync(goalsFile(), 'utf-8'))
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mts-home-'))
  process.env.MTS_TEST_HOME = home
  project = mkdtempSync(join(tmpdir(), 'mts-project-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
  delete process.env.MTS_TEST_HOME
})

/** A live server process with a `call` helper that awaits the matching reply. */
class Server {
  private readonly child: ChildProcessWithoutNullStreams
  private buffer = ''
  private readonly pending = new Map<number, (msg: Record<string, unknown>) => void>()

  constructor(scriptPath: string, tileId: string) {
    this.child = spawn(process.execPath, [scriptPath], {
      cwd: project,
      env: { ...process.env, MULTITERM_PTY_SESSION_ID: tileId }
    }) as ChildProcessWithoutNullStreams

    this.child.stdout.setEncoding('utf-8')
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let idx: number
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim()
        this.buffer = this.buffer.slice(idx + 1)
        if (!line) continue
        const msg = JSON.parse(line) as { id: number }
        this.pending.get(msg.id)?.(msg as unknown as Record<string, unknown>)
        this.pending.delete(msg.id)
      }
    })
  }

  call(id: number, method: string, params?: unknown): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 5000)
      this.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  /** The parsed payload of a tools/call, which the server returns as JSON text. */
  async callTool(id: number, name: string, args: unknown = {}): Promise<Record<string, unknown>> {
    const reply = (await this.call(id, 'tools/call', { name, arguments: args })) as {
      result: { content: Array<{ text: string }> }
    }
    return JSON.parse(reply.result.content[0].text)
  }

  close(): void {
    this.child.stdin.end()
    this.child.kill()
  }
}

async function startServer(tileId = 'tile-a'): Promise<Server> {
  const { installGoalServer, GOAL_SERVER_PATH } = await import('../../src/main/goalMcpServer')
  installGoalServer()
  const server = new Server(GOAL_SERVER_PATH, tileId)
  await server.call(1, 'initialize', { protocolVersion: '2025-06-18' })
  return server
}

describe('the goal MCP server', () => {
  it('advertises the four goal tools', async () => {
    const server = await startServer()
    const reply = (await server.call(2, 'tools/list')) as {
      result: { tools: Array<{ name: string }> }
    }
    server.close()

    expect(reply.result.tools.map((t) => t.name)).toEqual([
      'goal_get',
      'goal_complete',
      'goal_step_done',
      'goal_set'
    ])
  })

  it('reads the goal of the tile it was launched in', async () => {
    writeGoals({
      project: { text: 'Ship the release', steps: [], status: 'active', updatedAt: 1 },
      tiles: {
        'tile-a': {
          text: 'Migrate the git panel',
          steps: [
            { text: 'move the store', done: true },
            { text: 'update the tests', done: false }
          ],
          status: 'active',
          updatedAt: 2
        }
      }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_get')
    server.close()

    expect(result.goal).toBe('Migrate the git panel')
    expect(result.scope).toBe('this terminal')
    expect(result.steps).toEqual([
      { number: 1, text: 'move the store', done: true },
      { number: 2, text: 'update the tests', done: false }
    ])
  })

  it('falls back to the project goal when the tile has none', async () => {
    writeGoals({
      project: { text: 'Ship the release', steps: [], status: 'active', updatedAt: 1 },
      tiles: {}
    })

    const server = await startServer('tile-unknown')
    const result = await server.callTool(2, 'goal_get')
    server.close()

    expect(result.goal).toBe('Ship the release')
    expect(result.scope).toBe('project')
  })

  it('ticks a checklist step and reports what is left', async () => {
    writeGoals({
      project: null,
      tiles: {
        'tile-a': {
          text: 'Migrate',
          steps: [
            { text: 'move the store', done: false },
            { text: 'update the tests', done: false }
          ],
          status: 'active',
          updatedAt: 1
        }
      }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_step_done', { step: 1 })
    server.close()

    expect(result).toMatchObject({ ok: true, remaining: 1 })
    expect(readGoals().tiles['tile-a'].steps).toEqual([
      { text: 'move the store', done: true },
      { text: 'update the tests', done: false }
    ])
  })

  it('says the goal is still open after the last step is ticked', async () => {
    // Otherwise a checklist at 100% reads as a finished objective, and nobody
    // ever asks the user to close it.
    writeGoals({
      project: null,
      tiles: {
        'tile-a': {
          text: 'Migrate',
          steps: [{ text: 'move the store', done: false }],
          status: 'active',
          updatedAt: 1
        }
      }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_step_done', { step: 1 })
    server.close()

    expect(result.remaining).toBe(0)
    expect(String(result.note)).toContain('still open')
    expect(readGoals().tiles['tile-a'].status).toBe('active')
  })

  it('refuses a step number the goal does not have', async () => {
    writeGoals({
      project: null,
      tiles: { 'tile-a': { text: 'Migrate', steps: [], status: 'active', updatedAt: 1 } }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_step_done', { step: 4 })
    server.close()

    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('does not exist')
  })

  it('does not close a goal itself — it files a proposal', async () => {
    // The user runs with permission prompts bypassed, so the tool call cannot
    // be the confirmation. Completing has to wait for a click in the app.
    writeGoals({
      project: null,
      tiles: {
        'tile-a': {
          text: 'Migrate',
          steps: [{ text: 'move the store', done: false }],
          status: 'active',
          updatedAt: 1
        }
      }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_complete', {
      summary: 'Store moved, tests green.'
    })
    server.close()

    expect(result.status).toBe('awaiting_user')
    const stored = readGoals().tiles['tile-a']
    expect(stored.status).toBe('active')
    expect(stored.steps).toEqual([{ text: 'move the store', done: false }])
    expect(stored.proposal).toMatchObject({
      kind: 'complete',
      summary: 'Store moved, tests green.'
    })
  })

  it('refuses to propose completing a goal that is already closed', async () => {
    writeGoals({
      project: null,
      tiles: {
        'tile-a': { text: 'Migrate', steps: [], status: 'done', updatedAt: 1, completedAt: 2 }
      }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_complete', { summary: 'again' })
    server.close()

    expect(result.ok).toBe(false)
  })

  it('proposes a new goal instead of applying it, steps and all', async () => {
    writeGoals({
      project: null,
      tiles: { 'tile-a': { text: 'Old goal', steps: [], status: 'active', updatedAt: 1 } }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_set', {
      text: 'Rewrite the parser\n- lex the input\n- build the tree',
      reason: 'the old parser is beyond repair'
    })
    server.close()

    expect(result.status).toBe('awaiting_user')
    const stored = readGoals().tiles['tile-a']
    // The objective in force is unchanged until the user accepts.
    expect(stored.text).toBe('Old goal')
    expect(stored.proposal).toMatchObject({
      kind: 'change',
      text: 'Rewrite the parser',
      reason: 'the old parser is beyond repair',
      steps: [
        { text: 'lex the input', done: false },
        { text: 'build the tree', done: false }
      ]
    })
  })

  it('reads a goal that is nothing but a checklist', async () => {
    writeGoals({
      project: null,
      tiles: {
        'tile-a': {
          text: '',
          steps: [{ text: 'list the films', done: false }],
          status: 'active',
          updatedAt: 1
        }
      }
    })

    const server = await startServer('tile-a')
    const result = await server.callTool(2, 'goal_get')
    server.close()

    expect(result.has_goal).toBe(true)
    expect(result.steps).toEqual([{ number: 1, text: 'list the films', done: false }])
  })

  it('never touches the project-wide goal, even when inheriting it', async () => {
    // One terminal must not redirect the others: the proposal lands on the tile.
    writeGoals({
      project: { text: 'Ship the release', steps: [], status: 'active', updatedAt: 1 },
      tiles: {}
    })

    const server = await startServer('tile-a')
    await server.callTool(2, 'goal_set', { text: 'Something else', reason: 'because' })
    server.close()

    const stored = readGoals()
    expect((stored.project as { text: string }).text).toBe('Ship the release')
    expect((stored.project as { proposal?: unknown }).proposal).toBeUndefined()
    expect(stored.tiles['tile-a'].proposal).toMatchObject({ text: 'Something else' })
  })

  it('creates the goals file when the tile had no goal at all', async () => {
    const server = await startServer('tile-a')
    await server.callTool(2, 'goal_set', { text: 'A brand new goal', reason: 'starting out' })
    server.close()

    expect(existsSync(goalsFile())).toBe(true)
    expect(readGoals().tiles['tile-a'].proposal).toMatchObject({ text: 'A brand new goal' })
  })
})

describe('registering the server with Claude Code', () => {
  it('writes .mcp.json without disturbing servers the user added', async () => {
    const { registerGoalServer } = await import('../../src/main/goalMcpServer')
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { sentry: { type: 'http', url: 'https://example.com' } } })
    )

    registerGoalServer(project)

    const config = JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers.sentry).toBeDefined()
    expect(config.mcpServers['multiterm-goals'].args[0]).toContain('multiterm-goals.cjs')
  })

  it('does not rewrite an unchanged registration', async () => {
    // Rewriting would churn the file and re-trigger Claude Code's approval.
    const { registerGoalServer } = await import('../../src/main/goalMcpServer')
    registerGoalServer(project)
    const first = readFileSync(join(project, '.mcp.json'), 'utf-8')
    registerGoalServer(project)

    expect(readFileSync(join(project, '.mcp.json'), 'utf-8')).toBe(first)
  })

  it('takes the file with it when nothing else was in it', async () => {
    const { registerGoalServer, unregisterGoalServer } =
      await import('../../src/main/goalMcpServer')
    registerGoalServer(project)
    unregisterGoalServer(project)

    expect(existsSync(join(project, '.mcp.json'))).toBe(false)
  })

  it('leaves the file behind when the user has their own servers in it', async () => {
    const { registerGoalServer, unregisterGoalServer } =
      await import('../../src/main/goalMcpServer')
    writeFileSync(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { sentry: { type: 'http', url: 'https://example.com' } } })
    )

    registerGoalServer(project)
    unregisterGoalServer(project)

    const config = JSON.parse(readFileSync(join(project, '.mcp.json'), 'utf-8'))
    expect(config.mcpServers.sentry).toBeDefined()
    expect(config.mcpServers['multiterm-goals']).toBeUndefined()
  })
})
