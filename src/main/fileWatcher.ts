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

/** Returns the current worker instance. Defeats TS control-flow narrowing when
 *  `worker` has been narrowed to `null` earlier in a function body. */
function getWorker(): UtilityProcess | null {
  return worker
}

function spawnWorker(): void {
  if (worker) return
  stopping = false

  worker = utilityProcess.fork(workerPath())

  worker.on('message', (msg: { type: string; changes?: unknown[]; error?: string }) => {
    if (!currentWin || currentWin.isDestroyed()) return
    if (msg.type === 'changes') {
      currentWin.webContents.send('fs:changed', msg.changes)
    } else if (msg.type === 'git-changes') {
      // Its own channel: a git change must refresh the source control view
      // without making every open file tree re-read its children.
      currentWin.webContents.send('git:changed', msg.changes)
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
    // Re-start watching after respawn. TS narrows `worker` to null from the
    // assignment above and cannot track that spawnWorker() mutates the module
    // variable — read it through a helper to widen the type.
    if (currentFolders.length > 1) {
      getWorker()?.postMessage({ type: 'start-multi', folderPaths: currentFolders })
    } else if (currentFolders.length === 1) {
      getWorker()?.postMessage({ type: 'start', folderPath: currentFolders[0] })
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

/**
 * Stops watching one folder while leaving the rest of the workspace watched.
 *
 * Removing a single folder used to call stopFileWatcher(), which tore down
 * watching for every other folder still open.
 */
export function stopWatchingFolder(folderPath: string): void {
  const remaining = currentFolders.filter((f) => f !== folderPath)
  if (remaining.length === 0) {
    stopFileWatcher()
    return
  }
  if (remaining.length === currentFolders.length) return // not watched anyway
  if (currentWin) startMultiFileWatcher(remaining, currentWin)
}
