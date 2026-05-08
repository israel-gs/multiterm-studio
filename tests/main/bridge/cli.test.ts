/** @vitest-environment node */
import { describe, test, expect, vi } from 'vitest'

// ── Import the module under test ───────────────────────────────────────────────
// The CLI entry exports a pure `run(argv, env, deps)` function so tests never
// touch the actual socket or process.exit.
import { run } from '../../../src/main/bridge/cli/index'

// ── Helpers ───────────────────────────────────────────────────────────────────

type Deps = Parameters<typeof run>[2]

function makeDeps(overrides: Partial<Deps> = {}): Deps {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    call: vi.fn().mockResolvedValue({ ok: true }),
    log: vi.fn(),
    errlog: vi.fn(),
    ...overrides
  }
}

/** Env with MULTITERM_PANE_ID set */
const envWithId = (id = 'pane-abc'): NodeJS.ProcessEnv => ({
  ...process.env,
  MULTITERM_PANE_ID: id
})

/** Env without MULTITERM_PANE_ID */
const envNoId = (): NodeJS.ProcessEnv => {
  const e = { ...process.env }
  delete e.MULTITERM_PANE_ID
  return e
}

// ── send-to ───────────────────────────────────────────────────────────────────

describe('send-to', () => {
  test('success → calls bridge.send and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ ok: true, response: null }) })
    const code = await run(['send-to', '@x', 'hi'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.send',
      expect.objectContaining({ to: '@x', body: 'hi' })
    )
    expect(code).toBe(0)
  })

  test('decline error → exits 6', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32040, message: 'declined' })
    })
    const code = await run(['send-to', '@x', 'hi'], envWithId(), deps)
    expect(code).toBe(6)
  })

  test('timeout error → exits 7', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32041, message: 'timeout' })
    })
    const code = await run(['send-to', '@x', 'hi'], envWithId(), deps)
    expect(code).toBe(7)
  })

  test('target not found → exits 5', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32020, message: 'not found' })
    })
    const code = await run(['send-to', '@ghost', 'hi'], envWithId(), deps)
    expect(code).toBe(5)
  })

  test('missing MULTITERM_PANE_ID → exits 2 without calling bridge', async () => {
    const deps = makeDeps()
    const code = await run(['send-to', '@x', 'hi'], envNoId(), deps)
    expect(code).toBe(2)
    expect(deps.call).not.toHaveBeenCalled()
  })

  test('daemon not reachable (ECONNREFUSED) → exits 3', async () => {
    const err = Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
    const deps = makeDeps({ connect: vi.fn().mockRejectedValue(err) })
    const code = await run(['send-to', '@x', 'hi'], envWithId(), deps)
    expect(code).toBe(3)
  })

  test('BridgeDisabled error → exits 4', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32010, message: 'disabled' })
    })
    const code = await run(['send-to', '@x', 'hi'], envWithId(), deps)
    expect(code).toBe(4)
  })
})

// ── notify ────────────────────────────────────────────────────────────────────

describe('notify', () => {
  test('success → calls bridge.notify and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ ok: true, msgId: 'msg-1' }) })
    const code = await run(['notify', '@x', 'hello'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.notify',
      expect.objectContaining({ to: '@x', body: 'hello' })
    )
    expect(code).toBe(0)
  })

  test('target not found → exits 5', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32020, message: 'not found' })
    })
    const code = await run(['notify', '@nobody', 'ping'], envWithId(), deps)
    expect(code).toBe(5)
  })

  test('missing MULTITERM_PANE_ID → exits 2', async () => {
    const deps = makeDeps()
    const code = await run(['notify', '@x', 'hi'], envNoId(), deps)
    expect(code).toBe(2)
  })
})

// ── task ──────────────────────────────────────────────────────────────────────

describe('task subcommands', () => {
  test('task create → calls bridge.task.create and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ id: 't-1', status: 'open' }) })
    const code = await run(['task', 'create', 'do-something'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.task.create',
      expect.objectContaining({ name: 'do-something' })
    )
    expect(code).toBe(0)
  })

  test('task claim → calls bridge.task.claim and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ id: 't-1', status: 'claimed' }) })
    const code = await run(['task', 'claim', 't-1'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.task.claim',
      expect.objectContaining({ taskId: 't-1' })
    )
    expect(code).toBe(0)
  })

  test('task complete → calls bridge.task.complete and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ id: 't-1', status: 'done' }) })
    const code = await run(['task', 'complete', 't-1'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.task.complete',
      expect.objectContaining({ taskId: 't-1' })
    )
    expect(code).toBe(0)
  })

  test('task release → calls bridge.task.release and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ id: 't-1', status: 'open' }) })
    const code = await run(['task', 'release', 't-1'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.task.release',
      expect.objectContaining({ taskId: 't-1' })
    )
    expect(code).toBe(0)
  })

  test('task list → calls bridge.task.list and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue([]) })
    const code = await run(['task', 'list'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith('bridge.task.list', expect.anything())
    expect(code).toBe(0)
  })

  test('task not found → exits 5', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32030, message: 'task not found' })
    })
    const code = await run(['task', 'complete', 'nonexistent'], envWithId(), deps)
    expect(code).toBe(5)
  })
})

// ── kv ────────────────────────────────────────────────────────────────────────

describe('kv subcommands', () => {
  test('kv set → calls bridge.kv.set and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ ok: true }) })
    const code = await run(['kv', 'set', 'mykey', 'myval'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.kv.set',
      expect.objectContaining({ key: 'mykey', value: 'myval' })
    )
    expect(code).toBe(0)
  })

  test('kv get → calls bridge.kv.get and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ key: 'mykey', value: 'myval' }) })
    const code = await run(['kv', 'get', 'mykey'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.kv.get',
      expect.objectContaining({ key: 'mykey' })
    )
    expect(code).toBe(0)
  })

  test('kv del → calls bridge.kv.del and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ ok: true }) })
    const code = await run(['kv', 'del', 'mykey'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.kv.del',
      expect.objectContaining({ key: 'mykey' })
    )
    expect(code).toBe(0)
  })

  test('kv list → calls bridge.kv.list and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue([]) })
    const code = await run(['kv', 'list'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith('bridge.kv.list', expect.anything())
    expect(code).toBe(0)
  })

  test('kv key not found → exits 5', async () => {
    const deps = makeDeps({
      call: vi.fn().mockRejectedValue({ code: -32050, message: 'key invalid' })
    })
    const code = await run(['kv', 'get', 'bad!key'], envWithId(), deps)
    expect(code).toBe(5)
  })
})

// ── agent ─────────────────────────────────────────────────────────────────────

describe('agent subcommands', () => {
  test('agent list → calls bridge.agent.list and exits 0', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue([{ paneId: 'pane-a' }]) })
    const code = await run(['agent', 'list'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith('bridge.agent.list', expect.anything())
    expect(code).toBe(0)
  })

  test('agent alias → strips @ prefix and calls bridge.agent.alias with bare name', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ ok: true }) })
    const code = await run(['agent', 'alias', '@reviewer'], envWithId(), deps)
    expect(deps.call).toHaveBeenCalledWith(
      'bridge.agent.alias',
      expect.objectContaining({ alias: 'reviewer' })
    )
    expect(code).toBe(0)
  })

  test('agent alias without @ prefix → exit 2 with usage hint', async () => {
    const deps = makeDeps({ call: vi.fn().mockResolvedValue({ ok: true }) })
    const code = await run(['agent', 'alias', 'reviewer'], envWithId(), deps)
    expect(deps.call).not.toHaveBeenCalled()
    expect(code).toBe(2)
  })
})

// ── --json flag ───────────────────────────────────────────────────────────────

describe('--json flag', () => {
  test('--json causes output to be JSON-stringified', async () => {
    const result = [{ paneId: 'pane-a', alias: null }]
    const deps = makeDeps({ call: vi.fn().mockResolvedValue(result) })
    const code = await run(['--json', 'agent', 'list'], envWithId(), deps)
    expect(code).toBe(0)
    // log must have been called with the JSON string
    const logged = (deps.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(JSON.parse(logged)).toEqual(result)
  })
})

// ── help ──────────────────────────────────────────────────────────────────────

describe('help', () => {
  test('help → exits 0 and logs usage', async () => {
    const deps = makeDeps()
    const code = await run(['help'], envNoId(), deps)
    expect(code).toBe(0)
    expect((deps.log as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  test('help task → exits 0 even without MULTITERM_PANE_ID', async () => {
    const deps = makeDeps()
    const code = await run(['help', 'task'], envNoId(), deps)
    expect(code).toBe(0)
  })

  test('version → exits 0 even without MULTITERM_PANE_ID', async () => {
    const deps = makeDeps()
    const code = await run(['version'], envNoId(), deps)
    expect(code).toBe(0)
  })
})

// ── unknown subcommand ────────────────────────────────────────────────────────

describe('unknown subcommand', () => {
  test('bogus → exits 2 and writes to errlog', async () => {
    const deps = makeDeps()
    const code = await run(['bogus'], envWithId(), deps)
    expect(code).toBe(2)
    expect((deps.errlog as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  test('no subcommand → exits 2', async () => {
    const deps = makeDeps()
    const code = await run([], envNoId(), deps)
    expect(code).toBe(2)
  })
})
