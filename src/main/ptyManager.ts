import * as pty from 'node-pty'
import { ipcMain, WebContents } from 'electron'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { resolve } from 'path'

interface PtySession {
  process: pty.IPty
}

const sessions = new Map<string, PtySession>()

export function registerPtyHandlers(webContents: WebContents): void {
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
      env: { ...process.env }
    })

    ptyProcess.onData((data: string) => {
      webContents.send(`pty:data:${id}`, data)
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
  })
}
