import { ipcMain, BrowserWindow } from 'electron'
import { homedir } from 'os'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { handleAttentionEvent } from './attentionService'
import { getScrollbackBytes } from './settingsManager'
import type { SidecarClient } from './sidecar/client'

// Per-session cooldown: maps session id -> timestamp of last attention event (ms since epoch)
export const attentionCooldown = new Map<string, number>()

// Cooldown window: 5 seconds between attention events per session
export const ATTENTION_COOLDOWN_MS = 5_000

export const ATTENTION_PATTERN =
  /\([yYnN]\/[yYnN]\)|\[[yYnN]\/[yYnN]\]|Do you want|password:|press enter to continue|confirm\?/i

// --- Session metadata persistence ---

const SESSION_DIR = join(homedir(), '.multiterm-studio', 'sessions')

/**
 * One-shot migration: remove any session JSON files that were written by the
 * legacy tmux backend. A file is considered legacy if it is missing the
 * `backend` field, has `backend === 'tmux'`, or contains any tmux-specific
 * field (e.g. `tmuxName`).
 *
 * Called once at module load — errors are logged but never thrown upward.
 */
function purgeLegacyTmuxSessions(): void {
  try {
    if (!existsSync(SESSION_DIR)) return
    const files = readdirSync(SESSION_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      const filePath = join(SESSION_DIR, file)
      try {
        const raw = readFileSync(filePath, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const isLegacy =
          !('backend' in parsed) || parsed['backend'] === 'tmux' || 'tmuxName' in parsed
        if (isLegacy) {
          unlinkSync(filePath)
          console.warn(`[ptyManager] purged legacy tmux session: ${file}`)
        }
      } catch (fileErr) {
        console.warn(`[ptyManager] skipped ${file} during legacy purge:`, fileErr)
      }
    }
  } catch (err) {
    console.warn('[ptyManager] purgeLegacyTmuxSessions failed:', err)
  }
}

// Run migration once at module load
purgeLegacyTmuxSessions()

interface SessionMeta {
  shell: string
  cwd: string
  createdAt: string
}

function ensureSessionDir(): void {
  mkdirSync(SESSION_DIR, { recursive: true })
}

function writeSessionMeta(id: string, meta: SessionMeta): void {
  ensureSessionDir()
  writeFileSync(join(SESSION_DIR, `${id}.json`), JSON.stringify(meta))
}

function readSessionMeta(id: string): SessionMeta | null {
  try {
    return JSON.parse(readFileSync(join(SESSION_DIR, `${id}.json`), 'utf-8'))
  } catch {
    return null
  }
}

function deleteSessionMeta(id: string): void {
  try {
    unlinkSync(join(SESSION_DIR, `${id}.json`))
  } catch {
    // ignore
  }
}

// --- In-memory CWD cache (populated via OSC 7 push from renderer) ---

const cwdCache = new Map<string, string>()

// --- Session data-endpoint tracking (for onData unsubscription) ---

interface SessionEntry {
  dataEndpoint: string
}

const sessions = new Map<string, SessionEntry>()

// Module-level client reference (set by registerPtyHandlers) for use in exported helpers
let activeClient: SidecarClient | null = null

let currentWin: BrowserWindow | null = null
let ptyHandlersRegistered = false

/** Write data to a PTY session. Used by rpcServer for pane.sendText / pane.runCommand. */
export function writeToPty(id: string, data: string): boolean {
  if (!activeClient || !sessions.has(id)) return false
  activeClient.write(id, data).catch(() => {
    /* ignore */
  })
  return true
}

/** Return the list of active session IDs. Used by rpcServer for pane.list. */
export function listPtySessions(): string[] {
  return Array.from(sessions.keys())
}

/** Update the BrowserWindow reference used by PTY data push (called when window is re-created). */
export function setPtyWindow(win: BrowserWindow): void {
  currentWin = win
}

/** @internal Reset registration guard — only for tests */
export function _resetPtyHandlersForTests(): void {
  ptyHandlersRegistered = false
  currentWin = null
  activeClient = null
  sessions.clear()
  cwdCache.clear()
  attentionCooldown.clear()
}

export function registerPtyHandlers(win: BrowserWindow, client: SidecarClient): void {
  currentWin = win
  activeClient = client

  if (ptyHandlersRegistered) return
  ptyHandlersRegistered = true

  ipcMain.handle('pty:create', async (_event, id: string, cwd: string, initialCommand?: string) => {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

    const resolvedCwd = resolve(cwd)
    const safeCwd = existsSync(resolvedCwd) ? resolvedCwd : homedir()

    // Detect reconnect BEFORE calling client.create so we can skip metadata
    // writes that only apply to the first-time session creation.
    const isReconnect = sessions.has(id)

    // Create (or reconnect to) the PTY session in the sidecar.
    // After Fix A, session.create is idempotent: returns the existing endpoint
    // when the session already exists.
    const { dataEndpoint } = await client.create({
      sessionId: id,
      shell,
      cwd: safeCwd,
      cols: 80,
      rows: 24,
      scrollbackBytes: getScrollbackBytes()
    })

    sessions.set(id, { dataEndpoint })

    if (!isReconnect) {
      cwdCache.set(id, safeCwd)
      writeSessionMeta(id, { shell, cwd: safeCwd, createdAt: new Date().toISOString() })
    }

    // Wire the data socket FIRST (await ensures server has accepted the
    // connection and added this client to session.dataClients before replay).
    await client.onData(id, dataEndpoint, (chunk: Buffer) => {
      if (!currentWin || currentWin.isDestroyed()) return

      const data = chunk.toString('utf8')
      currentWin.webContents.send(`pty:data:${id}`, data)

      if (ATTENTION_PATTERN.test(data)) {
        const now = Date.now()
        const lastFired = attentionCooldown.get(id) ?? 0
        if (now - lastFired >= ATTENTION_COOLDOWN_MS) {
          attentionCooldown.set(id, now)
          const snippet = data.slice(0, 120).trim()
          currentWin.webContents.send('pty:attention', { id, snippet })
          handleAttentionEvent(currentWin, id, 'Terminal', snippet)
        }
      }
    })

    // Replay scrollback AFTER the data socket is connected so the ring buffer
    // flush reaches the renderer immediately.
    await client.replay(id).catch(() => {
      // No prior scrollback — ignore
    })

    // Write initial command last so any echo lands on the connected socket.
    if (initialCommand) {
      await client.write(id, initialCommand + '\n')
    }
  })

  ipcMain.handle('pty:write', async (_event, id: string, data: string) => {
    if (!sessions.has(id)) return
    await client.write(id, data)
  })

  ipcMain.handle('pty:resize', async (_event, id: string, cols: number, rows: number) => {
    if (!sessions.has(id)) return
    await client.resize(id, cols, rows)
  })

  ipcMain.handle('pty:has-process', async (_event, id: string) => {
    // The sidecar does not expose process detection; return false so the UI
    // does not block on a broken IPC. A future phase can add this.
    if (!sessions.has(id)) return { hasProcess: false, processName: null }
    return { hasProcess: false, processName: null }
  })

  ipcMain.handle('pty:get-cwd', (_event, id: string) => {
    // First try the live cache populated by OSC 7
    const cached = cwdCache.get(id)
    if (cached) return cached

    // Fall back to the spawn cwd stored in session metadata
    const meta = readSessionMeta(id)
    return meta ? meta.cwd : null
  })

  ipcMain.handle('pty:kill', async (_event, id: string) => {
    if (!sessions.has(id)) return
    await client.kill(id)
    sessions.delete(id)
    attentionCooldown.delete(id)
    cwdCache.delete(id)
    deleteSessionMeta(id)
  })

  // OSC 7 CWD push: renderer fires this after parsing an OSC 7 sequence
  ipcMain.on('pty:cwd-changed', (_event, id: string, cwd: string) => {
    cwdCache.set(id, cwd)
  })
}
