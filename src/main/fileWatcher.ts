import { utilityProcess, type UtilityProcess, BrowserWindow } from 'electron'
import { join } from 'path'

const MAX_RESTARTS = 5

let worker: UtilityProcess | null = null
let restartCount = 0
let stopping = false
let currentFolder: string | null = null
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
    if (currentFolder) {
      worker?.postMessage({ type: 'start', folderPath: currentFolder })
    }
  })
}

export function startFileWatcher(folderPath: string, win: BrowserWindow): void {
  stopFileWatcher()
  currentFolder = folderPath
  currentWin = win
  restartCount = 0

  spawnWorker()
  worker?.postMessage({ type: 'start', folderPath })
}

export function stopFileWatcher(): void {
  stopping = true
  currentFolder = null
  if (worker) {
    worker.postMessage({ type: 'stop' })
    worker.kill()
    worker = null
  }
}
