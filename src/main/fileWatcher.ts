import { utilityProcess, type UtilityProcess, BrowserWindow } from 'electron'
import { join } from 'path'

const MAX_RESTARTS = 5

let worker: UtilityProcess | null = null
let restartCount = 0
let stopping = false
let currentFolders: string[] = []
let currentWin: BrowserWindow | null = null

function workerPath(): string {
  return join(__dirname, 'watcher-worker.js')
}

function spawnWorker(): void {
  if (worker) return
  stopping = false

  worker = utilityProcess.fork(workerPath())

  worker.on('message', (msg: { type: string; changes?: unknown[]; error?: string }) => {
    if (msg.type === 'changes' && currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('fs:changed', msg.changes)
    }
  })

  worker.on('exit', (code) => {
    worker = null
    if (stopping) return

    if (restartCount >= MAX_RESTARTS) {
      console.error(`[file-watcher] Worker exited ${MAX_RESTARTS} times, giving up`)
      return
    }

    console.warn(`[file-watcher] Worker exited with code ${code}, restarting`)
    restartCount++
    spawnWorker()
    // Re-start watching after respawn
    if (currentFolders.length > 1) {
      worker?.postMessage({ type: 'start-multi', folderPaths: currentFolders })
    } else if (currentFolders.length === 1) {
      worker?.postMessage({ type: 'start', folderPath: currentFolders[0] })
    }
  })
}

export function startFileWatcher(folderPath: string, win: BrowserWindow): void {
  startMultiFileWatcher([folderPath], win)
}

export function startMultiFileWatcher(folderPaths: string[], win: BrowserWindow): void {
  stopFileWatcher()
  currentFolders = folderPaths
  currentWin = win
  restartCount = 0

  spawnWorker()
  if (folderPaths.length > 1) {
    worker?.postMessage({ type: 'start-multi', folderPaths })
  } else if (folderPaths.length === 1) {
    worker?.postMessage({ type: 'start', folderPath: folderPaths[0] })
  }
}

export function stopFileWatcher(): void {
  stopping = true
  currentFolders = []
  if (worker) {
    worker.postMessage({ type: 'stop' })
    worker.kill()
    worker = null
  }
}
