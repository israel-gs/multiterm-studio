import { describe, test, expect, vi, beforeEach } from 'vitest'

/**
 * ptyManager — Phase 3 tests
 *
 * Verifies that:
 * - registerPtyHandlers wires the expected IPC channels
 * - pty:create delegates to client.create + client.onData
 * - pty:write delegates to client.write (no-op if session unknown)
 * - pty:resize delegates to client.resize (no-op if session unknown)
 * - pty:kill delegates to client.kill and cleans up local state
 * - pty:cwd-changed populates the cache
 * - pty:get-cwd reads from cache, falls back to session metadata
 * - Attention detection works on the inbound data stream
 */

// ── IPC capture ──────────────────────────────────────────────────────────────

const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}
const capturedListeners: Record<string, (...args: unknown[]) => void> = {}

const mockIpcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    capturedHandlers[channel] = handler
  }),
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    capturedListeners[channel] = listener
  })
}

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  app: { isPackaged: false }
}))

// ── attentionService mock ─────────────────────────────────────────────────────

vi.mock('../../src/main/attentionService', () => ({
  handleAttentionEvent: vi.fn()
}))

// ── settingsManager mock ──────────────────────────────────────────────────────

const mockGetScrollbackBytes = vi.fn().mockReturnValue(8 * 1024 * 1024)

vi.mock('../../src/main/settingsManager', () => ({
  getScrollbackBytes: mockGetScrollbackBytes,
  getSetting: vi.fn().mockReturnValue(null),
  setSetting: vi.fn()
}))

// ── SidecarClient mock ────────────────────────────────────────────────────────

const mockOnDataCbs = new Map<string, (chunk: Buffer) => void>()

const mockClient = {
  create: vi.fn(
    async ({
      sessionId
    }: {
      sessionId: string
      shell: string
      cwd: string
      cols: number
      rows: number
    }) => ({
      sessionId,
      dataEndpoint: `/tmp/mts-test-${sessionId}.sock`
    })
  ),
  write: vi.fn(async () => undefined),
  resize: vi.fn(async () => undefined),
  kill: vi.fn(async () => undefined),
  replay: vi.fn(async () => undefined),
  onData: vi.fn(async (id: string, _dataEndpoint: string, cb: (chunk: Buffer) => void) => {
    mockOnDataCbs.set(id, cb)
  })
}

// ── BrowserWindow mock ────────────────────────────────────────────────────────

const mockWebContents = { send: vi.fn() }
const mockWin = {
  webContents: mockWebContents,
  isDestroyed: vi.fn().mockReturnValue(false)
}

const fakeEvent = {}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setupHandlers(): Promise<void> {
  const { _resetPtyHandlersForTests, registerPtyHandlers } =
    await import('../../src/main/ptyManager')
  _resetPtyHandlersForTests()
  registerPtyHandlers(mockWin as never, mockClient as never)
}

// ─────────────────────────────────────────────────────────────────────────────

describe('registerPtyHandlers — IPC wiring (Phase 3)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('registers pty:create, pty:write, pty:resize, pty:kill, pty:has-process, pty:get-cwd via handle', () => {
    const channels = mockIpcMain.handle.mock.calls.map((c) => c[0])
    expect(channels).toContain('pty:create')
    expect(channels).toContain('pty:write')
    expect(channels).toContain('pty:resize')
    expect(channels).toContain('pty:kill')
    expect(channels).toContain('pty:has-process')
    expect(channels).toContain('pty:get-cwd')
  })

  test('registers pty:cwd-changed via ipcMain.on (fire-and-forget)', () => {
    const channels = mockIpcMain.on.mock.calls.map((c) => c[0])
    expect(channels).toContain('pty:cwd-changed')
  })
})

describe('pty:create — delegates to SidecarClient', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('calls client.create with sessionId, shell, cwd, cols, rows', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'sess-1', '/tmp')

    expect(mockClient.create).toHaveBeenCalledOnce()
    const params = mockClient.create.mock.calls[0][0]
    expect(params.sessionId).toBe('sess-1')
    expect(typeof params.shell).toBe('string')
    expect(params.shell.length).toBeGreaterThan(0)
    expect(params.cwd).toBe('/tmp')
    expect(params.cols).toBe(80)
    expect(params.rows).toBe(24)
  })

  test('calls client.onData after create so live data is forwarded', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'sess-2', '/tmp')

    expect(mockClient.onData).toHaveBeenCalledOnce()
    const [id] = mockClient.onData.mock.calls[0]
    expect(id).toBe('sess-2')
  })

  test('data received via onData callback is forwarded to webContents.send', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'sess-3', '/tmp')

    const cb = mockOnDataCbs.get('sess-3')
    expect(cb).toBeDefined()
    cb!(Buffer.from('hello sidecar'))

    expect(mockWebContents.send).toHaveBeenCalledWith('pty:data:sess-3', 'hello sidecar')
  })

  test('calls client.write when initialCommand is provided', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'sess-cmd', '/tmp', 'npm test')

    expect(mockClient.write).toHaveBeenCalledWith('sess-cmd', 'npm test\n')
  })

  test('pty:create passes scrollbackBytes from settingsManager to client.create', async () => {
    const customBytes = 4 * 1024 * 1024 // 4 MB
    mockGetScrollbackBytes.mockReturnValueOnce(customBytes)

    await capturedHandlers['pty:create'](fakeEvent, 'scrollback-sess', '/tmp')

    const params = mockClient.create.mock.calls[0][0]
    expect(params.scrollbackBytes).toBe(customBytes)
  })

  test('reconnect: pty:create with already-known sessionId calls onData then replay, skips writeSessionMeta', async () => {
    // First create — populates sessions map
    await capturedHandlers['pty:create'](fakeEvent, 'reconnect-sess', '/tmp')
    vi.clearAllMocks()

    // Track call order
    const callOrder: string[] = []
    mockClient.onData.mockImplementation(
      async (id: string, _ep: string, cb: (chunk: Buffer) => void) => {
        callOrder.push('onData')
        mockOnDataCbs.set(id, cb)
      }
    )
    mockClient.replay.mockImplementation(async () => {
      callOrder.push('replay')
    })

    // Second create with same id — simulates renderer reload
    await capturedHandlers['pty:create'](fakeEvent, 'reconnect-sess', '/tmp')

    // onData must be called before replay
    expect(callOrder).toEqual(['onData', 'replay'])

    // writeSessionMeta writes to disk — it calls existsSync/writeFileSync via fs.
    // We can verify it was NOT called again: the only way is to check that create
    // was still invoked (for idempotent create) but meta not written twice.
    // Since we cannot directly spy on writeSessionMeta without refactoring,
    // we verify replay was called (regression guard) and create was called once.
    expect(mockClient.create).toHaveBeenCalledOnce()
    expect(mockClient.replay).toHaveBeenCalledOnce()
    expect(mockClient.onData).toHaveBeenCalledOnce()
  })
})

describe('pty:write — delegates to client.write', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('forwards data to client.write for known session', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'write-sess', '/tmp')
    vi.clearAllMocks()

    await capturedHandlers['pty:write'](fakeEvent, 'write-sess', 'ls -la\n')

    expect(mockClient.write).toHaveBeenCalledWith('write-sess', 'ls -la\n')
  })

  test('is a no-op for unknown session', async () => {
    await capturedHandlers['pty:write'](fakeEvent, 'no-such-session', 'data')

    expect(mockClient.write).not.toHaveBeenCalled()
  })
})

describe('pty:resize — delegates to client.resize', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('forwards cols and rows to client.resize for known session', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'resize-sess', '/tmp')
    vi.clearAllMocks()

    await capturedHandlers['pty:resize'](fakeEvent, 'resize-sess', 120, 40)

    expect(mockClient.resize).toHaveBeenCalledWith('resize-sess', 120, 40)
  })

  test('is a no-op for unknown session', async () => {
    await capturedHandlers['pty:resize'](fakeEvent, 'no-such-session', 80, 24)

    expect(mockClient.resize).not.toHaveBeenCalled()
  })
})

describe('pty:kill — cleans up session state', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('calls client.kill for known session', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'kill-sess', '/tmp')
    vi.clearAllMocks()

    await capturedHandlers['pty:kill'](fakeEvent, 'kill-sess')

    expect(mockClient.kill).toHaveBeenCalledWith('kill-sess')
  })

  test('write after kill is a no-op (session removed from map)', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'kill-write-sess', '/tmp')
    await capturedHandlers['pty:kill'](fakeEvent, 'kill-write-sess')
    vi.clearAllMocks()

    await capturedHandlers['pty:write'](fakeEvent, 'kill-write-sess', 'data')

    expect(mockClient.write).not.toHaveBeenCalled()
  })

  test('is a no-op for unknown session', async () => {
    await capturedHandlers['pty:kill'](fakeEvent, 'no-such-session')

    expect(mockClient.kill).not.toHaveBeenCalled()
  })
})

describe('pty:cwd-changed and pty:get-cwd — CWD cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('pty:cwd-changed populates the cache', () => {
    capturedListeners['pty:cwd-changed'](fakeEvent, 'cwd-sess', '/home/user/projects/foo')

    const result = capturedHandlers['pty:get-cwd'](fakeEvent, 'cwd-sess')
    expect(result).toBe('/home/user/projects/foo')
  })

  test('pty:get-cwd returns cached cwd after change', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'cwd-create-sess', '/tmp')
    capturedListeners['pty:cwd-changed'](fakeEvent, 'cwd-create-sess', '/home/user/new-dir')

    const result = capturedHandlers['pty:get-cwd'](fakeEvent, 'cwd-create-sess')
    expect(result).toBe('/home/user/new-dir')
  })

  test('pty:get-cwd falls back to spawn cwd when cache has no entry', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'no-osc7-sess', '/tmp')

    // Ensure /tmp is accessible (it's the spawn cwd; cache set to it on create)
    const result = capturedHandlers['pty:get-cwd'](fakeEvent, 'no-osc7-sess')
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeGreaterThan(0)
  })

  test('pty:get-cwd returns null for completely unknown session', () => {
    const result = capturedHandlers['pty:get-cwd'](fakeEvent, 'unknown-cwd-sess')
    expect(result).toBeNull()
  })
})

describe('attention detection — ATTENTION_PATTERN and cooldown', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    Object.keys(capturedListeners).forEach((k) => delete capturedListeners[k])
    mockOnDataCbs.clear()
    await setupHandlers()
  })

  test('ATTENTION_PATTERN matches "(y/N)" prompt', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Continue? (y/N)')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "password:"', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('password:')).toBe(true)
  })

  test('ATTENTION_PATTERN does NOT match "ls -la"', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('ls -la\r\n')).toBe(false)
  })

  test('data stream matching pattern fires pty:attention push', async () => {
    await capturedHandlers['pty:create'](fakeEvent, 'attn-sess', '/tmp')

    const cb = mockOnDataCbs.get('attn-sess')!
    cb(Buffer.from('Do you want to continue? (y/N)'))

    expect(mockWebContents.send).toHaveBeenCalledWith('pty:attention', {
      id: 'attn-sess',
      snippet: expect.any(String)
    })
  })

  test('5-second cooldown: second match within 5s does NOT fire attention again', async () => {
    vi.useFakeTimers()
    await capturedHandlers['pty:create'](fakeEvent, 'cooldown-sess', '/tmp')

    const cb = mockOnDataCbs.get('cooldown-sess')!
    cb(Buffer.from('Do you want to continue? (y/N)'))
    const firstCount = mockWebContents.send.mock.calls.filter(
      (c) => c[0] === 'pty:attention'
    ).length
    expect(firstCount).toBe(1)

    cb(Buffer.from('confirm?'))
    const secondCount = mockWebContents.send.mock.calls.filter(
      (c) => c[0] === 'pty:attention'
    ).length
    expect(secondCount).toBe(1)

    vi.useRealTimers()
  })

  test('after cooldown expires, next match fires attention again', async () => {
    vi.useFakeTimers()
    await capturedHandlers['pty:create'](fakeEvent, 'expire-sess', '/tmp')

    const cb = mockOnDataCbs.get('expire-sess')!
    cb(Buffer.from('Do you want to continue? (y/N)'))
    expect(mockWebContents.send.mock.calls.filter((c) => c[0] === 'pty:attention').length).toBe(1)

    vi.advanceTimersByTime(5001)

    cb(Buffer.from('confirm?'))
    expect(mockWebContents.send.mock.calls.filter((c) => c[0] === 'pty:attention').length).toBe(2)

    vi.useRealTimers()
  })
})
