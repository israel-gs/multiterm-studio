import * as pty from 'node-pty'
import { ipcMain, BrowserWindow, app } from 'electron'
import { homedir } from 'os'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { execFileSync } from 'child_process'
import { handleAttentionEvent } from './attentionService'

const TMUX_SOCKET = 'multiterm'

interface PtySession {
  process: pty.IPty
  tmuxName: string
}

const sessions = new Map<string, PtySession>()

let tmuxMouseEnabled = true

export function setTmuxMouseMode(enabled: boolean): void {
  tmuxMouseEnabled = enabled
  try {
    tmuxExec('set-option', '-g', 'mouse', enabled ? 'on' : 'off')
  } catch {
    // tmux server might not be running yet
  }
}

export function getTmuxMouseMode(): boolean {
  return tmuxMouseEnabled
}

// Per-session cooldown: maps session id -> timestamp of last attention event (ms since epoch)
export const attentionCooldown = new Map<string, number>()

// Cooldown window: 5 seconds between attention events per session
export const ATTENTION_COOLDOWN_MS = 5_000

export const ATTENTION_PATTERN =
  /\([yYnN]\/[yYnN]\)|\[[yYnN]\/[yYnN]\]|Do you want|password:|press enter to continue|confirm\?/i

// --- Bundle-aware tmux helpers ---

function getTmuxBin(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'tmux')
  return 'tmux'
}

function getTmuxConf(): string {
  if (app?.isPackaged) return join(process.resourcesPath, 'tmux.conf')
  return join(app?.getAppPath() ?? process.cwd(), 'resources', 'tmux.conf')
}

function getTerminfoDir(): string | undefined {
  if (app?.isPackaged) return join(process.resourcesPath, 'terminfo')
  return undefined
}

function tmuxEnv(): NodeJS.ProcessEnv {
  const dir = getTerminfoDir()
  if (!dir) return process.env
  return { ...process.env, TERMINFO: dir }
}

function tmuxExec(...args: string[]): string {
  return execFileSync(getTmuxBin(), ['-L', TMUX_SOCKET, '-f', getTmuxConf(), ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 5_000,
    env: tmuxEnv()
  }).trim()
}

function tmuxSessionName(id: string): string {
  return `mts-${id.replace(/-/g, '').slice(0, 16)}`
}

// --- Session metadata persistence ---

const SESSION_DIR = join(homedir(), '.multiterm-studio', 'sessions')

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

// --- Orphan tmux session cleanup ---

export function cleanupOrphanSessions(knownPanelIds: string[]): void {
  let tmuxNames: string[]
  try {
    const raw = tmuxExec('list-sessions', '-F', '#{session_name}')
    tmuxNames = raw.split('\n').filter(Boolean)
  } catch {
    tmuxNames = []
  }

  const knownNames = new Set(knownPanelIds.map(tmuxSessionName))

  // Read metadata files to also consider known sessions
  try {
    const metaFiles = readdirSync(SESSION_DIR).filter((f) => f.endsWith('.json'))
    for (const file of metaFiles) {
      const id = file.replace('.json', '')
      const name = tmuxSessionName(id)
      if (!knownNames.has(name)) {
        // Metadata exists but not in layout — delete metadata
        deleteSessionMeta(id)
      }
    }
  } catch {
    // SESSION_DIR doesn't exist yet — fine
  }

  for (const name of tmuxNames) {
    if (name.startsWith('mts-') && !knownNames.has(name)) {
      try {
        tmuxExec('kill-session', '-t', name)
      } catch {
        // ignore
      }
    }
  }
}

// --- PTY exports for RPC server ---

export function writeToPty(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.process.write(data)
  return true
}

export function sendRawKeys(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  try {
    tmuxExec('send-keys', '-l', '-t', session.tmuxName, data)
    return true
  } catch {
    return false
  }
}

export function listPtySessions(): string[] {
  return Array.from(sessions.keys())
}

export function registerPtyHandlers(win: BrowserWindow): void {
  const { webContents } = win

  ipcMain.handle('pty:create', (_event, id: string, cwd: string) => {
    const shell =
      process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

    const resolvedCwd = resolve(cwd)
    const safeCwd = existsSync(resolvedCwd) ? resolvedCwd : homedir()
    const tmuxName = tmuxSessionName(id)

    // Kill previous PTY attach process if it exists (React StrictMode calls
    // ptyCreate twice in dev — the first node-pty process must be killed or
    // both will send data to the same channel, causing duplicate output).
    const prevSession = sessions.get(id)
    if (prevSession) {
      prevSession.process.kill()
      sessions.delete(id)
    }

    // Create or reconnect to tmux session
    let sessionExists = false
    let scrollback = ''
    try {
      tmuxExec('has-session', '-t', tmuxName)
      sessionExists = true
    } catch {
      // doesn't exist
    }

    if (sessionExists) {
      // Recover scrollback (plain text, no escape sequences)
      try {
        const raw = tmuxExec('capture-pane', '-t', tmuxName, '-p', '-S', '-10000')
        const lines = raw.split('\n')
        let end = lines.length
        while (end > 0 && lines[end - 1].trim() === '') end--
        if (end > 0) scrollback = lines.slice(0, end).join('\r\n') + '\r\n'
      } catch {
        // ignore
      }
      // Resize to match current terminal size
      try {
        tmuxExec('resize-window', '-t', tmuxName, '-x', '80', '-y', '24')
      } catch {
        // ignore
      }
    } else {
      tmuxExec(
        'new-session', '-d', '-s', tmuxName,
        '-c', safeCwd,
        '-x', '80', '-y', '24'
      )
      tmuxExec('set-option', '-t', tmuxName, 'status', 'off')
      tmuxExec('set-option', '-g', 'mouse', tmuxMouseEnabled ? 'on' : 'off')
      tmuxExec('set-environment', '-t', tmuxName, 'MULTITERM_PTY_SESSION_ID', id)
      tmuxExec('set-environment', '-t', tmuxName, 'SHELL', shell)
      tmuxExec('set-environment', '-t', tmuxName, 'TERM_PROGRAM', 'multiterm-studio')
      writeSessionMeta(id, { shell, cwd: safeCwd, createdAt: new Date().toISOString() })
    }

    // Attach to tmux session via node-pty
    const ptyProcess = pty.spawn('tmux', ['-L', TMUX_SOCKET, '-f', getTmuxConf(), '-u', 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: safeCwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      }
    })

    // Send recovered scrollback before live data
    if (scrollback) {
      webContents.send(`pty:scrollback:${id}`, scrollback)
    }

    ptyProcess.onData((data: string) => {
      webContents.send(`pty:data:${id}`, data)

      if (ATTENTION_PATTERN.test(data)) {
        const now = Date.now()
        const lastFired = attentionCooldown.get(id) ?? 0
        if (now - lastFired >= ATTENTION_COOLDOWN_MS) {
          attentionCooldown.set(id, now)
          const snippet = data.slice(0, 120).trim()
          webContents.send('pty:attention', { id, snippet })
          handleAttentionEvent(win, id, 'Terminal', snippet)
        }
      }
    })

    sessions.set(id, { process: ptyProcess, tmuxName })
  })

  ipcMain.handle('pty:write', (_event, id: string, data: string) => {
    const session = sessions.get(id)
    if (!session) return
    session.process.write(data)
  })

  ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
    const session = sessions.get(id)
    if (!session) return
    try {
      tmuxExec('resize-window', '-t', session.tmuxName, '-x', String(cols), '-y', String(rows))
    } catch {
      // ignore
    }
    session.process.resize(cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    try {
      tmuxExec('kill-session', '-t', session.tmuxName)
    } catch {
      // ignore
    }
    session.process.kill()
    sessions.delete(id)
    attentionCooldown.delete(id)
    deleteSessionMeta(id)
  })
}
