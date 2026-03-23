import { describe, test, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

// Note: After Task 1 GREEN phase, registerPtyHandlers signature changes from
// (webContents: WebContents) to (win: BrowserWindow). The mockWin below
// provides both win.webContents and win.isFocused() as the new signature requires.

/**
 * INFRA-02: All IPC channels registered via contextBridge
 * INFRA-03: node-pty only imported in main process
 * TERM-01: PTY spawns real shell session
 * TERM-02: Shell starts with cwd set to project folder
 *
 * Mocking strategy:
 * - vi.mock('electron') captures ipcMain.handle calls into capturedHandlers
 * - vi.mock('node-pty') provides a mock spawn that returns a controllable IPty
 * - registerPtyHandlers is called once, then handlers are invoked via capturedHandlers
 */

// --- Module-level mock state (shared across all tests, reset via mockClear/mockReset) ---

// Captures handlers registered by ipcMain.handle(channel, handler)
const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}

const mockIpcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    capturedHandlers[channel] = handler
  })
}

const mockPtyProcess = {
  onData: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn()
}

const mockPtySpawn = vi.fn(() => mockPtyProcess)

vi.mock('electron', () => ({
  ipcMain: mockIpcMain
}))

vi.mock('node-pty', () => ({
  default: { spawn: mockPtySpawn },
  spawn: mockPtySpawn
}))

// Mock attentionService to isolate ptyManager tests from Notification side-effects
vi.mock('../../src/main/attentionService', () => ({
  handleAttentionEvent: vi.fn()
}))


const mockWebContents = { send: vi.fn() }
const mockWin = {
  webContents: mockWebContents,
  isFocused: vi.fn().mockReturnValue(false),
  show: vi.fn(),
  focus: vi.fn()
}
const fakeEvent = {}

describe('ptyManager IPC handlers (INFRA-02)', () => {
  beforeEach(async () => {
    // Clear all spy/mock histories
    vi.clearAllMocks()
    // Clear captured handlers so each test starts fresh
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    // Reset the registration guard so each test can re-register handlers
    const { _resetPtyHandlersForTests } = await import('../../src/main/ptyManager')
    _resetPtyHandlersForTests()
  })

  test('registerPtyHandlers registers exactly 4 IPC handlers', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(4)
    const registeredChannels = mockIpcMain.handle.mock.calls.map((c) => c[0])
    expect(registeredChannels).toContain('pty:create')
    expect(registeredChannels).toContain('pty:write')
    expect(registeredChannels).toContain('pty:resize')
    expect(registeredChannels).toContain('pty:kill')
  })

  test('pty:create handler spawns PTY with correct shell, args, and options', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)

    const testCwd = tmpdir()
    await capturedHandlers['pty:create'](fakeEvent, 'session-1', testCwd)

    expect(mockPtySpawn).toHaveBeenCalledOnce()
    const [shell, args, opts] = mockPtySpawn.mock.calls[0]
    expect(typeof shell).toBe('string')
    expect(shell.length).toBeGreaterThan(0)
    expect(Array.isArray(args)).toBe(true)
    expect(opts.name).toBe('xterm-256color')
    expect(opts.cols).toBe(80)
    expect(opts.rows).toBe(24)
    expect(opts.cwd).toBe(testCwd)
    expect(opts.env).toMatchObject(process.env)
  })

  test('pty:create onData triggers webContents.send with correct channel and data', async () => {
    let capturedOnDataCb: ((data: string) => void) | null = null
    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnDataCb = cb
    })

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-2', '/tmp')

    expect(capturedOnDataCb).not.toBeNull()
    capturedOnDataCb!('hello from shell')
    expect(mockWebContents.send).toHaveBeenCalledWith('pty:data:session-2', 'hello from shell')
  })

  test('pty:write handler writes data to correct PTY session', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-3', '/tmp')

    await capturedHandlers['pty:write'](fakeEvent, 'session-3', 'ls -la\n')

    expect(mockPtyProcess.write).toHaveBeenCalledWith('ls -la\n')
  })

  test('pty:resize handler calls resize with correct cols and rows', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-4', '/tmp')

    await capturedHandlers['pty:resize'](fakeEvent, 'session-4', 120, 40)

    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40)
  })

  test('pty:kill handler kills PTY and removes session from Map', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-5', '/tmp')

    await capturedHandlers['pty:kill'](fakeEvent, 'session-5')

    expect(mockPtyProcess.kill).toHaveBeenCalledOnce()
    // After kill, write to same id should be no-op (session removed from Map)
    await capturedHandlers['pty:write'](fakeEvent, 'session-5', 'test')
    expect(mockPtyProcess.write).not.toHaveBeenCalled()
  })

  test('pty:write with unknown id does not throw', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)

    expect(() => capturedHandlers['pty:write'](fakeEvent, 'nonexistent', 'data')).not.toThrow()
    expect(mockPtyProcess.write).not.toHaveBeenCalled()
  })

  test('pty:resize with unknown id does not throw', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)

    expect(() => capturedHandlers['pty:resize'](fakeEvent, 'nonexistent', 80, 24)).not.toThrow()
    expect(mockPtyProcess.resize).not.toHaveBeenCalled()
  })

  test('pty:kill with unknown id does not throw', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)

    expect(() => capturedHandlers['pty:kill'](fakeEvent, 'nonexistent')).not.toThrow()
    expect(mockPtyProcess.kill).not.toHaveBeenCalled()
  })
})

describe('PTY session behavior (TERM-01, TERM-02)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    const { _resetPtyHandlersForTests } = await import('../../src/main/ptyManager')
    _resetPtyHandlersForTests()
  })

  test('spawns with process.env.SHELL', async () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = '/usr/bin/fish'

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'term-01', '/tmp')

    expect(mockPtySpawn.mock.calls[0][0]).toBe('/usr/bin/fish')
    process.env.SHELL = originalShell
  })

  test('spawns with cwd from IPC argument', async () => {
    const testCwd = tmpdir()
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'term-02', testCwd)

    expect(mockPtySpawn.mock.calls[0][2].cwd).toBe(testCwd)
  })
})

describe('attention detection (ATTN-01, ATTN-02)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    const { _resetPtyHandlersForTests } = await import('../../src/main/ptyManager')
    _resetPtyHandlersForTests()
  })

  test('ATTENTION_PATTERN matches "? " prompt character', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Do you want to continue? ')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "(y/N)" prompt', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Continue? (y/N)')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "[Y/n]" prompt', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Install package? [Y/n]')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "(Y/n)" prompt', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Proceed? (Y/n)')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "(y/n)" prompt', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Are you sure? (y/n)')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "[y/n]" prompt', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Override? [y/n]')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "Do you want to continue?"', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Do you want to continue?')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "Password:" (case-insensitive)', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Password:')).toBe(true)
    expect(ATTENTION_PATTERN.test('password:')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "press enter to continue"', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Press ENTER to continue')).toBe(true)
  })

  test('ATTENTION_PATTERN matches "confirm?"', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Please confirm?')).toBe(true)
  })

  test('ATTENTION_PATTERN does NOT match "ls -la"', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('ls -la\r\n')).toBe(false)
  })

  test('ATTENTION_PATTERN does NOT match "npm install" output', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('added 120 packages in 3s\r\n')).toBe(false)
  })

  test('ATTENTION_PATTERN does NOT match "Compiling..."', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('Compiling src/main/index.ts...\r\n')).toBe(false)
  })

  test('ATTENTION_PATTERN does NOT match regular terminal output', async () => {
    const { ATTENTION_PATTERN } = await import('../../src/main/ptyManager')
    expect(ATTENTION_PATTERN.test('git status\r\ntotal 12\r\n')).toBe(false)
  })

  test('onData fires pty:attention IPC push when pattern matches', async () => {
    let capturedOnDataCb: ((data: string) => void) | null = null
    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnDataCb = cb
    })

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'attn-session', '/tmp')

    capturedOnDataCb!('Do you want to continue? (y/N)')
    expect(mockWebContents.send).toHaveBeenCalledWith('pty:attention', {
      id: 'attn-session',
      snippet: expect.any(String)
    })
  })

  test('onData always sends pty:data:{id} regardless of attention match', async () => {
    let capturedOnDataCb: ((data: string) => void) | null = null
    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnDataCb = cb
    })

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'data-session', '/tmp')

    capturedOnDataCb!('Do you want to continue? (y/N)')
    expect(mockWebContents.send).toHaveBeenCalledWith('pty:data:data-session', 'Do you want to continue? (y/N)')
  })

  test('5-second cooldown: second match within 5s does NOT fire attention event', async () => {
    vi.useFakeTimers()
    let capturedOnDataCb: ((data: string) => void) | null = null
    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnDataCb = cb
    })

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'cooldown-session', '/tmp')

    capturedOnDataCb!('Do you want to continue? (y/N)')
    const firstCount = mockWebContents.send.mock.calls.filter(c => c[0] === 'pty:attention').length
    expect(firstCount).toBe(1)

    // Second match within 5s — should NOT fire again
    capturedOnDataCb!('confirm?')
    const secondCount = mockWebContents.send.mock.calls.filter(c => c[0] === 'pty:attention').length
    expect(secondCount).toBe(1)

    vi.useRealTimers()
  })

  test('after 5s cooldown expires, next match fires attention event again', async () => {
    vi.useFakeTimers()
    let capturedOnDataCb: ((data: string) => void) | null = null
    mockPtyProcess.onData.mockImplementation((cb: (data: string) => void) => {
      capturedOnDataCb = cb
    })

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'expire-session', '/tmp')

    capturedOnDataCb!('Do you want to continue? (y/N)')
    expect(mockWebContents.send.mock.calls.filter(c => c[0] === 'pty:attention').length).toBe(1)

    // Advance past the 5-second cooldown
    vi.advanceTimersByTime(5001)

    capturedOnDataCb!('confirm?')
    expect(mockWebContents.send.mock.calls.filter(c => c[0] === 'pty:attention').length).toBe(2)

    vi.useRealTimers()
  })

  test('per-session isolation: two sessions can fire attention events independently', async () => {
    const mockPtyProcess2 = { onData: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn() }
    let onDataCb1: ((data: string) => void) | null = null
    let onDataCb2: ((data: string) => void) | null = null

    // First call returns mockPtyProcess, second returns mockPtyProcess2
    mockPtySpawn
      .mockReturnValueOnce({ ...mockPtyProcess, onData: vi.fn((cb) => { onDataCb1 = cb }) })
      .mockReturnValueOnce({ ...mockPtyProcess2, onData: vi.fn((cb) => { onDataCb2 = cb }) })

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWin as never)
    await capturedHandlers['pty:create'](fakeEvent, 'iso-session-1', '/tmp')
    await capturedHandlers['pty:create'](fakeEvent, 'iso-session-2', '/tmp')

    onDataCb1!('Do you want to continue? (y/N)')
    onDataCb2!('Password:')

    const attentionCalls = mockWebContents.send.mock.calls.filter(c => c[0] === 'pty:attention')
    expect(attentionCalls.length).toBe(2)
    expect(attentionCalls[0][1].id).toBe('iso-session-1')
    expect(attentionCalls[1][1].id).toBe('iso-session-2')
  })
})
