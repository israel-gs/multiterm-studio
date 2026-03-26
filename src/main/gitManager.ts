import { ipcMain } from 'electron'
import { execFile } from 'child_process'

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr })
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

let gitHandlersRegistered = false

export function registerGitHandlers(): void {
  if (gitHandlersRegistered) return
  gitHandlersRegistered = true
  ipcMain.handle('git:is-repo', async (_event, folderPath: string) => {
    try {
      await runGit(['rev-parse', '--is-inside-work-tree'], folderPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'git:branches',
    async (
      _event,
      folderPath: string
    ): Promise<{ current: string; branches: string[]; detached: boolean }> => {
      const [headResult, branchResult] = await Promise.all([
        runGit(['rev-parse', '--abbrev-ref', 'HEAD'], folderPath),
        runGit(['branch', '--list', '--no-color'], folderPath)
      ])

      const current = headResult.stdout.trim()
      const detached = current === 'HEAD'

      const branches = branchResult.stdout
        .split('\n')
        .map((line) => line.replace(/^\*?\s+/, '').trim())
        .filter(Boolean)

      return { current, branches, detached }
    }
  )

  ipcMain.handle(
    'git:checkout',
    async (
      _event,
      folderPath: string,
      branch: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        await runGit(['checkout', branch], folderPath)
        return { ok: true }
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? 'Checkout failed'
        return { ok: false, error: stderr }
      }
    }
  )

  ipcMain.handle(
    'git:create-branch',
    async (
      _event,
      folderPath: string,
      branchName: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        await runGit(['checkout', '-b', branchName], folderPath)
        return { ok: true }
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? 'Failed to create branch'
        return { ok: false, error: stderr }
      }
    }
  )

  ipcMain.handle(
    'git:delete-branch',
    async (
      _event,
      folderPath: string,
      branchName: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        await runGit(['branch', '-d', branchName], folderPath)
        return { ok: true }
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? 'Failed to delete branch'
        return { ok: false, error: stderr }
      }
    }
  )
}
