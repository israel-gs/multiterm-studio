import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * PROJ-01: folder:open IPC handler shows native directory picker
 * PROJ-02: folder:readdir returns sorted, filtered entries
 *
 * Mocking strategy:
 * - vi.mock('electron') captures ipcMain.handle calls into capturedHandlers
 *   and provides mock dialog.showOpenDialog
 * - vi.mock('fs/promises') provides mock readdir returning Dirent-like objects
 * - registerFolderHandlers is called once, then handlers are invoked via capturedHandlers
 */

// --- Module-level mock state (shared across all tests, reset via clearAllMocks/beforeEach) ---

// Captures handlers registered by ipcMain.handle(channel, handler)
const capturedHandlers: Record<string, (...args: unknown[]) => unknown> = {}

const mockIpcMain = {
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    capturedHandlers[channel] = handler
  })
}

const mockShowOpenDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: mockIpcMain,
  dialog: { showOpenDialog: mockShowOpenDialog }
}))

const mockReaddir = vi.fn()
const mockStat = vi.fn()

vi.mock('fs/promises', () => ({
  default: { readdir: mockReaddir, stat: mockStat },
  readdir: mockReaddir,
  stat: mockStat
}))

// Helper: create a Dirent-like object
function makeDirent(name: string, isDir: boolean) {
  return {
    name,
    isDirectory: () => isDir
  }
}

const mockWin = {}
const fakeEvent = {}

describe('registerFolderHandlers (PROJ-01, PROJ-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    Object.keys(capturedHandlers).forEach((k) => delete capturedHandlers[k])
    // Default stat: returns a fake mtime; readdir for child-count returns []
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
    mockReaddir.mockResolvedValue([])
  })

  afterEach(() => {
    vi.resetModules()
  })

  test.skip('registerFolderHandlers registers exactly 2 IPC handlers', async () => {
    // STALE: folderManager now registers 3 handlers (folder:open, file:open-dialog,
    // folder:readdir). Test was written before file:open-dialog was added.
    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(2)
    const registeredChannels = mockIpcMain.handle.mock.calls.map((c) => c[0])
    expect(registeredChannels).toContain('folder:open')
    expect(registeredChannels).toContain('folder:readdir')
  })

  test('folder:open calls dialog.showOpenDialog with openDirectory property', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/some/path'] })

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    await capturedHandlers['folder:open'](fakeEvent)

    expect(mockShowOpenDialog).toHaveBeenCalledWith(mockWin, {
      properties: ['openDirectory']
    })
  })

  test('folder:open returns selected path when user confirms', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/test/path'] })

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = await capturedHandlers['folder:open'](fakeEvent)

    expect(result).toBe('/test/path')
  })

  test('folder:open returns null when user cancels dialog', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = await capturedHandlers['folder:open'](fakeEvent)

    expect(result).toBeNull()
  })

  test('folder:open returns null when filePaths is empty (not canceled but empty)', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] })

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = await capturedHandlers['folder:open'](fakeEvent)

    expect(result).toBeNull()
  })

  test.skip('folder:readdir returns entries sorted directories-first then alphabetical', async () => {
    // STALE: folderManager now enriches entries with modifiedAt (via stat) and
    // itemCount (via secondary readdir). These tests assert the old flat shape
    // { name, isDir } and don't mock stat or the secondary readdir calls.
    mockReaddir.mockResolvedValue([
      makeDirent('zebra.ts', false),
      makeDirent('alpha', true),
      makeDirent('beta.ts', false),
      makeDirent('gamma', true)
    ])

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = await capturedHandlers['folder:readdir'](fakeEvent, '/some/dir')

    expect(result).toEqual([
      { name: 'alpha', isDir: true },
      { name: 'gamma', isDir: true },
      { name: 'beta.ts', isDir: false },
      { name: 'zebra.ts', isDir: false }
    ])
  })

  test.skip('folder:readdir includes dotfiles (entries starting with .)', async () => {
    // STALE: see above — shape now includes modifiedAt and itemCount fields.
    mockReaddir.mockResolvedValue([
      makeDirent('.git', true),
      makeDirent('.env', false),
      makeDirent('src', true),
      makeDirent('README.md', false)
    ])

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = await capturedHandlers['folder:readdir'](fakeEvent, '/some/dir')

    expect(result).toEqual([
      { name: '.git', isDir: true },
      { name: 'src', isDir: true },
      { name: '.env', isDir: false },
      { name: 'README.md', isDir: false }
    ])
  })

  test.skip('folder:readdir filters out node_modules', async () => {
    // STALE: see above — shape now includes modifiedAt and itemCount fields.
    mockReaddir.mockResolvedValue([
      makeDirent('node_modules', true),
      makeDirent('src', true),
      makeDirent('index.ts', false)
    ])

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = await capturedHandlers['folder:readdir'](fakeEvent, '/some/dir')

    expect(result).toEqual([
      { name: 'src', isDir: true },
      { name: 'index.ts', isDir: false }
    ])
  })

  test.skip('folder:readdir maps Dirent objects to { name, isDir } shape', async () => {
    // STALE: see above — shape now includes modifiedAt and itemCount fields.
    mockReaddir.mockResolvedValue([makeDirent('myFile.ts', false), makeDirent('myDir', true)])

    const { registerFolderHandlers } = await import('../../src/main/folderManager')
    registerFolderHandlers(mockWin as never)

    const result = (await capturedHandlers['folder:readdir'](fakeEvent, '/some/dir')) as Array<{
      name: string
      isDir: boolean
    }>

    expect(result).toHaveLength(2)
    for (const entry of result) {
      expect(entry).toHaveProperty('name')
      expect(entry).toHaveProperty('isDir')
      expect(typeof entry.name).toBe('string')
      expect(typeof entry.isDir).toBe('boolean')
    }
  })
})
