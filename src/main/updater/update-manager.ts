import electronUpdater from 'electron-updater'
const { autoUpdater } = electronUpdater
import { app, BrowserWindow, powerMonitor } from 'electron'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  progress?: number
  version?: string
  releaseNotes?: string
  error?: string
}

const ERROR_RESET_DELAY_MS = 30_000
const CHECK_INTERVAL_MS = 60 * 60 * 1000
const INITIAL_CHECK_DELAY_MS = 5_000

class UpdateManager {
  private state: UpdateState = { status: 'idle' }
  private initialized = false
  private errorResetTimeout: NodeJS.Timeout | null = null
  private checkInterval: NodeJS.Timeout | null = null
  private onBeforeQuit: (() => Promise<void>) | null = null

  init(opts?: { onBeforeQuit?: () => Promise<void> }): void {
    if (this.initialized) return
    this.onBeforeQuit = opts?.onBeforeQuit ?? null

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    // Allow updates for unsigned/dev-signed builds
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = {
      info: (msg: string) => console.log(`[updater] ${msg}`),
      warn: (msg: string) => console.warn(`[updater] ${msg}`),
      error: (msg: string) => console.error(`[updater] ${msg}`),
      debug: (msg: string) => console.debug(`[updater] ${msg}`)
    }

    autoUpdater.on('checking-for-update', () => {
      this.setState({ status: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      const releaseNotes =
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
      this.setState({
        status: 'available',
        version: info.version,
        releaseNotes
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.setState({ status: 'idle' })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        status: 'downloading',
        progress: Math.round(progress.percent)
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      const releaseNotes =
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
      this.setState({
        status: 'ready',
        version: info.version,
        releaseNotes
      })
    })

    autoUpdater.on('error', (err) => {
      this.handleError(err.message)
    })

    if (app.isPackaged) {
      setTimeout(() => this.checkForUpdates(), INITIAL_CHECK_DELAY_MS)
      this.checkInterval = setInterval(() => this.checkForUpdates(), CHECK_INTERVAL_MS)
      powerMonitor.on('resume', () => this.checkForUpdates())
    } else {
      autoUpdater.forceDevUpdateConfig = true
    }

    this.initialized = true
  }

  async checkForUpdates(): Promise<void> {
    const s = this.state.status
    if (s === 'checking' || s === 'downloading') return
    if (s === 'available' || s === 'ready') return

    if (s === 'error') this.clearErrorTimeout()

    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.handleError((err as Error).message)
    }
  }

  async downloadAvailableUpdate(): Promise<void> {
    if (this.state.status !== 'available') return

    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.handleError((err as Error).message)
    }
  }

  async install(): Promise<void> {
    if (this.state.status !== 'ready') return

    this.setState({ status: 'installing', version: this.state.version })

    if (!app.isPackaged) return

    // Run cleanup explicitly so PTY sessions, watchers, and servers are
    // shut down before quitAndInstall terminates the process.
    if (this.onBeforeQuit) {
      await this.onBeforeQuit()
    }

    autoUpdater.quitAndInstall()
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    this.clearErrorTimeout()
  }

  private handleError(message: string): void {
    this.setState({ status: 'error', error: message })
    this.scheduleErrorReset()
  }

  private clearErrorTimeout(): void {
    if (this.errorResetTimeout) {
      clearTimeout(this.errorResetTimeout)
      this.errorResetTimeout = null
    }
  }

  private scheduleErrorReset(): void {
    this.clearErrorTimeout()
    this.errorResetTimeout = setTimeout(() => {
      if (this.state.status === 'error') {
        this.setState({ status: 'idle', error: undefined })
      }
      this.errorResetTimeout = null
    }, ERROR_RESET_DELAY_MS)
  }

  private setState(newState: Partial<UpdateState>): void {
    this.state = { ...this.state, ...newState }
    this.broadcast()
  }

  private broadcast(): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send('update:status', this.state)
      }
    }
  }
}

export const updateManager = new UpdateManager()
