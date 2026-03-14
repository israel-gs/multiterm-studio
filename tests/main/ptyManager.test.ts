import { describe, test, expect, vi, beforeEach } from 'vitest'
import { tmpdir } from 'os'

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


const mockWebContents = { send: vi.fn() }
const fakeEvent = {}

describe('ptyManager IPC handlers (INFRA-02)', () => {
  beforeEach(() => {
    // Clear all spy/mock histories
    vi.clearAllMocks()
    // Clear captured handlers so each test starts fresh
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
  })

  test('registerPtyHandlers registers exactly 4 IPC handlers', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(4)
    const registeredChannels = mockIpcMain.handle.mock.calls.map((c) => c[0])
    expect(registeredChannels).toContain('pty:create')
    expect(registeredChannels).toContain('pty:write')
    expect(registeredChannels).toContain('pty:resize')
    expect(registeredChannels).toContain('pty:kill')
  })

  test('pty:create handler spawns PTY with correct shell, args, and options', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)

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
    registerPtyHandlers(mockWebContents as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-2', '/tmp')

    expect(capturedOnDataCb).not.toBeNull()
    capturedOnDataCb!('hello from shell')
    expect(mockWebContents.send).toHaveBeenCalledWith('pty:data:session-2', 'hello from shell')
  })

  test('pty:write handler writes data to correct PTY session', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-3', '/tmp')

    await capturedHandlers['pty:write'](fakeEvent, 'session-3', 'ls -la\n')

    expect(mockPtyProcess.write).toHaveBeenCalledWith('ls -la\n')
  })

  test('pty:resize handler calls resize with correct cols and rows', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-4', '/tmp')

    await capturedHandlers['pty:resize'](fakeEvent, 'session-4', 120, 40)

    expect(mockPtyProcess.resize).toHaveBeenCalledWith(120, 40)
  })

  test('pty:kill handler kills PTY and removes session from Map', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)
    await capturedHandlers['pty:create'](fakeEvent, 'session-5', '/tmp')

    await capturedHandlers['pty:kill'](fakeEvent, 'session-5')

    expect(mockPtyProcess.kill).toHaveBeenCalledOnce()
    // After kill, write to same id should be no-op (session removed from Map)
    await capturedHandlers['pty:write'](fakeEvent, 'session-5', 'test')
    expect(mockPtyProcess.write).not.toHaveBeenCalled()
  })

  test('pty:write with unknown id does not throw', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)

    expect(() => capturedHandlers['pty:write'](fakeEvent, 'nonexistent', 'data')).not.toThrow()
    expect(mockPtyProcess.write).not.toHaveBeenCalled()
  })

  test('pty:resize with unknown id does not throw', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)

    expect(() => capturedHandlers['pty:resize'](fakeEvent, 'nonexistent', 80, 24)).not.toThrow()
    expect(mockPtyProcess.resize).not.toHaveBeenCalled()
  })

  test('pty:kill with unknown id does not throw', async () => {
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)

    expect(() => capturedHandlers['pty:kill'](fakeEvent, 'nonexistent')).not.toThrow()
    expect(mockPtyProcess.kill).not.toHaveBeenCalled()
  })
})

describe('PTY session behavior (TERM-01, TERM-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
  })

  test('spawns with process.env.SHELL', async () => {
    const originalShell = process.env.SHELL
    process.env.SHELL = '/usr/bin/fish'

    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)
    await capturedHandlers['pty:create'](fakeEvent, 'term-01', '/tmp')

    expect(mockPtySpawn.mock.calls[0][0]).toBe('/usr/bin/fish')
    process.env.SHELL = originalShell
  })

  test('spawns with cwd from IPC argument', async () => {
    const testCwd = tmpdir()
    const { registerPtyHandlers } = await import('../../src/main/ptyManager')
    registerPtyHandlers(mockWebContents as never)
    await capturedHandlers['pty:create'](fakeEvent, 'term-02', testCwd)

    expect(mockPtySpawn.mock.calls[0][2].cwd).toBe(testCwd)
  })
})
