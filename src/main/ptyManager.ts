import * as pty from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { resolve } from 'path'
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

// Check if tmux is available at startup
let tmuxAvailable = false
try {
  execFileSync('tmux', ['-V'], { encoding: 'utf-8', stdio: 'pipe' })
  tmuxAvailable = true
} catch {
  // tmux not installed — fall back to raw shells
}

function tmuxExec(...args: string[]): string {
  return execFileSync('tmux', ['-L', TMUX_SOCKET, ...args], {
    encoding: 'utf-8',
    stdio: 'pipe'
  }).trim()
}

function tmuxSessionName(id: string): string {
  return `mts-${id.replace(/-/g, '').slice(0, 16)}`
}

/** Split a tmux pane in the terminal identified by ptySessionId */
export function splitAgentPane(
  ptySessionId: string,
  viewerCmd: string
): boolean {
  if (!tmuxAvailable) return false
  const name = tmuxSessionName(ptySessionId)
  try {
    tmuxExec('split-window', '-t', name, '-h', '-l', '50%', viewerCmd)
    return true
  } catch {
    return false
  }
}

export function registerPtyHandlers(win: BrowserWindow): void {
  const { webContents } = win

  ipcMain.handle('pty:create', (_event, id: string, cwd: string) => {
    const shell =
      process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

    const resolvedCwd = resolve(cwd)
    const safeCwd = existsSync(resolvedCwd) ? resolvedCwd : homedir()
    const tmuxName = tmuxSessionName(id)

    let ptyProcess: pty.IPty

    if (tmuxAvailable) {
      // Create detached tmux session
      tmuxExec(
        'new-session', '-d', '-s', tmuxName,
        '-c', safeCwd,
        '-x', '80', '-y', '24'
      )
      // Set env vars on the tmux session (inherited by all panes)
      tmuxExec('set-environment', '-t', tmuxName, 'MULTITERM_PTY_SESSION_ID', id)
      tmuxExec('set-environment', '-t', tmuxName, 'SHELL', shell)
      tmuxExec('set-environment', '-t', tmuxName, 'TERM_PROGRAM', 'multiterm-studio')

      // Attach to tmux session via node-pty
      ptyProcess = pty.spawn('tmux', ['-L', TMUX_SOCKET, '-u', 'attach-session', '-t', tmuxName], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color'
        }
      })
    } else {
      // Fallback: raw shell (no tmux)
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env: {
          ...process.env,
          PROMPT_EOL_MARK: '',
          COLORTERM: 'truecolor',
          LANG: process.env.LANG || 'en_US.UTF-8',
          TERM_PROGRAM: 'multiterm-studio',
          MULTITERM_PTY_SESSION_ID: id
        }
      })
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
    if (tmuxAvailable) {
      try {
        tmuxExec('resize-window', '-t', session.tmuxName, '-x', String(cols), '-y', String(rows))
      } catch {
        // ignore
      }
    }
    session.process.resize(cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    if (tmuxAvailable) {
      try {
        tmuxExec('kill-session', '-t', session.tmuxName)
      } catch {
        // ignore
      }
    }
    session.process.kill()
    sessions.delete(id)
    attentionCooldown.delete(id)
  })
}
