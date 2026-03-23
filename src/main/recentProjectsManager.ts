import { ipcMain, app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export interface RecentProject {
  path: string
  name: string
  lastOpened: number // timestamp ms
  openCount: number
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
  try {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
    await writeFile(dataPath(), JSON.stringify(projects, null, 2))
  } catch {
    // Silent failure
  }
}

let recentHandlersRegistered = false

export function registerRecentProjectsHandlers(): void {
  if (recentHandlersRegistered) return
  recentHandlersRegistered = true
  ipcMain.handle('projects:recent', async () => {
    return loadRecent()
  })

  ipcMain.handle('projects:add', async (_event, folderPath: string) => {
    const projects = await loadRecent()
    const name = folderPath.split('/').pop() ?? folderPath
    const existing = projects.find((p) => p.path === folderPath)
    if (existing) {
      existing.lastOpened = Date.now()
      existing.openCount += 1
    } else {
      projects.unshift({
        path: folderPath,
        name,
        lastOpened: Date.now(),
        openCount: 1
      })
    }
    // Sort by most recently opened, keep max 20
    projects.sort((a, b) => b.lastOpened - a.lastOpened)
    const trimmed = projects.slice(0, 20)
    await saveRecent(trimmed)
    return trimmed
  })

  ipcMain.handle('projects:remove', async (_event, folderPath: string) => {
    const projects = await loadRecent()
    const filtered = projects.filter((p) => p.path !== folderPath)
    await saveRecent(filtered)
    return filtered
  })
}
