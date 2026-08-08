import { ipcMain, app } from 'electron'
import { readFile, writeFile, rename, mkdir, unlink } from 'fs/promises'
import { basename, join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { reportError } from './errorReporter'

export interface RecentProject {
  path: string
  name: string
  lastOpened: number // timestamp ms
  openCount: number
  type?: 'folder' | 'workspace'
  folderNames?: string[] // workspace only: names of contained folders
}

function dataPath(): string {
  return join(app.getPath('userData'), 'recent-projects.json')
}

async function loadRecent(): Promise<RecentProject[]> {
  try {
    const raw = await readFile(dataPath(), 'utf-8')
    return JSON.parse(raw) as RecentProject[]
  } catch {
    return []
  }
}

async function saveRecent(projects: RecentProject[]): Promise<void> {
  const target = dataPath()
  // Write-then-rename like every other store in the app, so a crash mid-write
  // cannot leave a truncated recent-projects file behind.
  const tmp = `${target}.${randomUUID()}.tmp`
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(tmp, JSON.stringify(projects, null, 2))
    await rename(tmp, target)
  } catch (err) {
    reportError('recent-projects', 'Could not update the recent projects list', err)
    try {
      await unlink(tmp)
    } catch {
      /* ignore cleanup errors */
    }
  }
}

let recentHandlersRegistered = false

export function registerRecentProjectsHandlers(): void {
  if (recentHandlersRegistered) return
  recentHandlersRegistered = true
  ipcMain.handle('projects:recent', async () => {
    return loadRecent()
  })

  ipcMain.handle(
    'projects:add',
    async (
      _event,
      folderPath: string,
      meta?: { type?: 'folder' | 'workspace'; folderNames?: string[] }
    ) => {
      const projects = await loadRecent()
      const name = basename(folderPath) || folderPath
      const existing = projects.find((p) => p.path === folderPath)
      if (existing) {
        existing.lastOpened = Date.now()
        existing.openCount += 1
        if (meta?.type) existing.type = meta.type
        if (meta?.folderNames) existing.folderNames = meta.folderNames
      } else {
        projects.unshift({
          path: folderPath,
          name,
          lastOpened: Date.now(),
          openCount: 1,
          type: meta?.type ?? 'folder',
          folderNames: meta?.folderNames
        })
      }
      // Sort by most recently opened, keep max 20
      projects.sort((a, b) => b.lastOpened - a.lastOpened)
      const trimmed = projects.slice(0, 20)
      await saveRecent(trimmed)
      return trimmed
    }
  )

  ipcMain.handle('projects:remove', async (_event, folderPath: string) => {
    const projects = await loadRecent()
    const filtered = projects.filter((p) => p.path !== folderPath)
    await saveRecent(filtered)
    return filtered
  })
}
