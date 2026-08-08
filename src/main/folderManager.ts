import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readdir, stat } from 'fs/promises'
import type { Dirent } from 'fs'
import { join, relative, sep } from 'path'
import {
  FILE_SEARCH_IGNORED_DIRS,
  FILE_SEARCH_MAX_RESULTS,
  type FileSearchMatch,
  type FileSearchResult
} from '../shared/search'

let currentWin: BrowserWindow | null = null
let folderHandlersRegistered = false

export function registerFolderHandlers(win: BrowserWindow): void {
  currentWin = win

  if (folderHandlersRegistered) return
  folderHandlersRegistered = true

  ipcMain.handle('folder:open', async () => {
    if (!currentWin) return null
    const result = await dialog.showOpenDialog(currentWin, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle(
    'file:open-dialog',
    async (_event, filters?: { name: string; extensions: string[] }[]) => {
      if (!currentWin) return null
      const result = await dialog.showOpenDialog(currentWin, {
        properties: ['openFile'],
        filters: filters ?? []
      })
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    }
  )

  ipcMain.handle('folder:readdir', async (_event, dirPath: string) => {
    // A workspace can legitimately reference a folder that is not currently
    // reachable (unmounted volume, renamed directory). Report it as empty
    // rather than rejecting and breaking the whole tree.
    let entries: Dirent[]
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch {
      return []
    }
    const filtered = entries.filter((e) => e.name !== 'node_modules')

    const enriched = await Promise.all(
      filtered.map(async (e) => {
        const fullPath = join(dirPath, e.name)
        const isDir = e.isDirectory()
        try {
          const s = await stat(fullPath)
          const result: {
            name: string
            isDir: boolean
            itemCount?: number
            modifiedAt?: number
          } = { name: e.name, isDir, modifiedAt: s.mtimeMs }

          if (isDir) {
            const children = await readdir(fullPath)
            result.itemCount = children.filter((c) => c !== 'node_modules').length
          }
          return result
        } catch {
          return { name: e.name, isDir }
        }
      })
    )

    return enriched.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  })

  ipcMain.handle(
    'file:search',
    async (_event, rootPath: string, query: string): Promise<FileSearchResult> =>
      searchFiles(rootPath, query)
  )
}

/** Directories walked before the search gives up and reports a partial list. */
const MAX_DIRS_VISITED = 5000

/**
 * Find files under `rootPath` whose name matches `query`.
 *
 * A query containing a slash is matched against the path relative to the root,
 * so "main/index" finds src/main/index.ts; anything else is matched against the
 * file name alone, so a deep directory name cannot flood the results.
 *
 * The walk is breadth-first on purpose: when the limits cut it short, what
 * survives is the shallow part of the tree, which is the part the user is most
 * likely to have meant.
 */
export async function searchFiles(rootPath: string, query: string): Promise<FileSearchResult> {
  const needle = query.trim().toLowerCase()
  if (!needle) return { matches: [], truncated: false }

  const matchOnPath = needle.includes('/')
  const matches: FileSearchMatch[] = []
  const queue: string[] = [rootPath]
  let dirsVisited = 0
  let truncated = false

  while (queue.length > 0) {
    if (dirsVisited >= MAX_DIRS_VISITED || matches.length >= FILE_SEARCH_MAX_RESULTS) {
      truncated = true
      break
    }

    const dir = queue.shift()!
    dirsVisited++

    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Unreadable directory (permissions, unmounted volume) — skip it rather
      // than failing the whole search.
      continue
    }

    for (const entry of entries) {
      // A symlinked directory can point back up the tree; following it would
      // let the walk loop forever.
      if (entry.isSymbolicLink()) continue

      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!FILE_SEARCH_IGNORED_DIRS.includes(entry.name)) queue.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue

      const relativePath = relative(rootPath, fullPath).split(sep).join('/')
      const haystack = (matchOnPath ? relativePath : entry.name).toLowerCase()
      if (haystack.includes(needle)) matches.push({ path: fullPath, relativePath })
    }
  }

  return { matches: rankMatches(matches, needle), truncated }
}

/**
 * Names that start with the query come first — typing "git" should surface
 * gitManager.ts above something that merely contains "git" mid-name — and
 * shallower paths win ties.
 */
function rankMatches(matches: FileSearchMatch[], needle: string): FileSearchMatch[] {
  const base = needle.includes('/') ? (needle.split('/').pop() ?? needle) : needle
  return matches.sort((a, b) => {
    const aName = a.relativePath.slice(a.relativePath.lastIndexOf('/') + 1).toLowerCase()
    const bName = b.relativePath.slice(b.relativePath.lastIndexOf('/') + 1).toLowerCase()
    const aStarts = aName.startsWith(base)
    const bStarts = bName.startsWith(base)
    if (aStarts !== bStarts) return aStarts ? -1 : 1

    const aDepth = a.relativePath.split('/').length
    const bDepth = b.relativePath.split('/').length
    if (aDepth !== bDepth) return aDepth - bDepth

    return a.relativePath.localeCompare(b.relativePath)
  })
}
