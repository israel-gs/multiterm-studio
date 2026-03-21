import * as pty from 'node-pty'
import { ipcMain, BrowserWindow, app } from 'electron'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { resolve, join } from 'path'
import { execFileSync } from 'child_process'
import { handleAttentionEvent } from './attentionService'

const TMUX_SOCKET = 'multiterm'

interface PtySession {
  process: pty.IPty
  tmuxName: string
}

const sessions = new Map<string, PtySession>()

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
  return execFileSync(getTmuxBin(), ['-L', TMUX_SOCKET, '-u', '-f', getTmuxConf(), ...args], {
    encoding: 'utf-8',
    stdio: 'pipe',
    timeout: 5_000,
    env: tmuxEnv()
  }).trim()
}

function tmuxSessionName(id: string): string {
  return `mts-${id.replace(/-/g, '').slice(0, 16)}`
}

// --- PTY exports for RPC server ---

export function writeToPty(id: string, data: string): boolean {
  const session = sessions.get(id)
  if (!session) return false
  session.process.write(data)
  return true
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

    // Kill stale session if it exists (avoids corrupt scrollback on reconnect)
    try {
      tmuxExec('kill-session', '-t', tmuxName)
    } catch {
      // didn't exist — fine
    }

    tmuxExec(
      'new-session', '-d', '-s', tmuxName,
      '-c', safeCwd,
      '-x', '80', '-y', '24'
    )
    tmuxExec('set-environment', '-t', tmuxName, 'MULTITERM_PTY_SESSION_ID', id)
    tmuxExec('set-environment', '-t', tmuxName, 'SHELL', shell)
    tmuxExec('set-environment', '-t', tmuxName, 'TERM_PROGRAM', 'multiterm-studio')

    // Build attach env — include TERMINFO for bundled terminfo
    const attachEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TERM: 'xterm-256color'
    }
    const terminfoDir = getTerminfoDir()
    if (terminfoDir) attachEnv.TERMINFO = terminfoDir

    // Attach to tmux session via node-pty
    const ptyProcess = pty.spawn(
      getTmuxBin(),
      ['-L', TMUX_SOCKET, '-u', '-f', getTmuxConf(), 'attach-session', '-t', tmuxName],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env: attachEnv
      }
    )

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
  })
}
