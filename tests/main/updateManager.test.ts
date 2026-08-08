/** @vitest-environment node */
import { describe, expect, it, beforeEach, vi } from 'vitest'

/**
 * The updater drives quit-and-install, so the behaviour worth pinning is the
 * state machine around it: never install from a state that is not ready, always
 * run the cleanup callback first (PTYs, watchers and sockets have to come down
 * before the process is replaced), and never act at all outside a packaged app.
 */

const sent: Array<{ channel: string; payload: unknown }> = []
const quitAndInstall = vi.fn()
const openExternal = vi.fn().mockResolvedValue(undefined)

let isPackaged = true
let platform = 'linux'

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged
    }
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload })
        }
      }
    ]
  },
  powerMonitor: { on: vi.fn() },
  shell: { openExternal: (url: string) => openExternal(url) }
}))

const listeners: Record<string, (...args: unknown[]) => void> = {}

function fakeAutoUpdater(): Record<string, unknown> {
  return {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowDowngrade: false,
      forceDevUpdateConfig: false,
      logger: null,
      on: (event: string, cb: (...args: unknown[]) => void) => {
        listeners[event] = cb
      },
      checkForUpdates: vi.fn().mockResolvedValue(undefined),
      downloadUpdate: vi.fn().mockResolvedValue(undefined),
      quitAndInstall
    }
  }
}

async function freshManager(): Promise<typeof import('../../src/main/updater/update-manager')> {
  vi.resetModules()
  for (const k of Object.keys(listeners)) delete listeners[k]
  sent.length = 0
  const mod = await import('../../src/main/updater/update-manager')
  mod.setAutoUpdaterProvider(fakeAutoUpdater)
  return mod
}

beforeEach(() => {
  vi.clearAllMocks()
  isPackaged = true
  platform = 'linux'
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
})

describe('update state', () => {
  it('starts idle', async () => {
    const { updateManager } = await freshManager()
    expect(updateManager.getState().status).toBe('idle')
  })

  it('broadcasts each transition to the renderer', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()

    listeners['checking-for-update']?.()

    expect(sent.at(-1)).toMatchObject({ channel: 'update:status' })
    expect(updateManager.getState().status).toBe('checking')
  })

  it('records the version when an update is available', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()

    listeners['update-available']?.({ version: '9.9.9' })

    expect(updateManager.getState()).toMatchObject({ version: '9.9.9' })
  })

  it('keeps release notes only when they are a string', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()

    listeners['update-available']?.({ version: '1.0.0', releaseNotes: [{ note: 'x' }] })

    expect(updateManager.getState().releaseNotes).toBeUndefined()
  })

  it('surfaces errors', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()

    listeners['error']?.(new Error('network down'))

    expect(updateManager.getState()).toMatchObject({ status: 'error', error: 'network down' })
  })

  it('reports download progress as a whole percentage', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()

    listeners['download-progress']?.({ percent: 42.7 })

    expect(updateManager.getState()).toMatchObject({ status: 'downloading', progress: 43 })
  })
})

describe('install', () => {
  it('does nothing unless the state is ready', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()

    await updateManager.install()

    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('does nothing in a development build', async () => {
    isPackaged = false
    const { updateManager } = await freshManager()
    updateManager.init()
    listeners['update-downloaded']?.({ version: '2.0.0' })

    await updateManager.install()

    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('shuts the app down cleanly before replacing the process', async () => {
    // PTY sessions, watchers and sockets must be released first.
    const order: string[] = []
    quitAndInstall.mockImplementation(() => order.push('quitAndInstall'))

    const { updateManager } = await freshManager()
    updateManager.init({
      onBeforeQuit: async () => {
        order.push('cleanup')
      }
    })
    listeners['update-downloaded']?.({ version: '2.0.0' })

    await updateManager.install()

    expect(order).toEqual(['cleanup', 'quitAndInstall'])
  })

  it('opens the release page instead of installing on macOS', async () => {
    // Without notarization quitAndInstall fails silently there.
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })

    const { updateManager } = await freshManager()
    updateManager.init()
    listeners['update-available']?.({ version: '3.1.4' })

    await updateManager.install()

    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('v3.1.4'))
  })
})

describe('checkForUpdates', () => {
  it('does not start a second check while one is running', async () => {
    const { updateManager } = await freshManager()
    updateManager.init()
    listeners['checking-for-update']?.()

    const before = updateManager.getState().status
    await updateManager.checkForUpdates()

    expect(before).toBe('checking')
    expect(updateManager.getState().status).toBe('checking')
  })
})
