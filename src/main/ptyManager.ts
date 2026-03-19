import * as pty from 'node-pty'
import { ipcMain, BrowserWindow } from 'electron'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { handleAttentionEvent } from './attentionService'

interface PtySession {
  process: pty.IPty
}

const sessions = new Map<string, PtySession>()

// Per-session cooldown: maps session id -> timestamp of last attention event (ms since epoch)
export const attentionCooldown = new Map<string, number>()

// Cooldown window: 5 seconds between attention events per session
export const ATTENTION_COOLDOWN_MS = 5_000

/**
 * Conservative attention pattern — matches high-confidence interactive prompts only.
 * Designed to minimize false positives on normal terminal output.
 *
 * Patterns:
 *   - (y/N), (Y/n), (y/n), (Y/N)  — yes/no confirmation prompts
 *   - [Y/n], [y/N], [y/n], [Y/N]  — bracket-style yes/no
 *   - Do you want                  — explicit "Do you want..." phrasing
 *   - password:                    — password input request (case-insensitive)
 *   - press enter to continue      — "press enter" instruction (case-insensitive)
 *   - confirm?                     — direct confirmation question (case-insensitive)
 */
export const ATTENTION_PATTERN =
  /\([yYnN]\/[yYnN]\)|\[[yYnN]\/[yYnN]\]|Do you want|password:|press enter to continue|confirm\?/i

export function registerPtyHandlers(win: BrowserWindow): void {
  const { webContents } = win

  ipcMain.handle('pty:create', (_event, id: string, cwd: string) => {
    const shell =
      process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

    // Resolve cwd to absolute path, fall back to home directory
    const resolvedCwd = resolve(cwd)
    const safeCwd = existsSync(resolvedCwd) ? resolvedCwd : homedir()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: safeCwd,
      env: { ...process.env, PROMPT_EOL_MARK: '' }
    })

    ptyProcess.onData((data: string) => {
      // Always forward PTY data to renderer
      webContents.send(`pty:data:${id}`, data)

      // Attention detection: check if output matches an interactive prompt pattern
      if (ATTENTION_PATTERN.test(data)) {
        const now = Date.now()
        const lastFired = attentionCooldown.get(id) ?? 0

        if (now - lastFired >= ATTENTION_COOLDOWN_MS) {
          attentionCooldown.set(id, now)
          const snippet = data.slice(0, 120).trim()
          webContents.send('pty:attention', { id, snippet })

          // Fire native notification if the app is backgrounded
          // Panel title is not available in ptyManager; we use a generic title here.
          // The renderer can display the actual title via the panel:focus IPC flow.
          handleAttentionEvent(win, id, 'Terminal', snippet)
        }
      }
    })

    sessions.set(id, { process: ptyProcess })
  })

  ipcMain.handle('pty:write', (_event, id: string, data: string) => {
    const session = sessions.get(id)
    if (!session) return
    session.process.write(data)
  })

  ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
    const session = sessions.get(id)
    if (!session) return
    session.process.resize(cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    session.process.kill()
    sessions.delete(id)
    attentionCooldown.delete(id)
  })
}
