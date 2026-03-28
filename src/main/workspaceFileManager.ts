import { mkdir, writeFile, rename, readFile, unlink } from 'fs/promises'
import { mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs'
import { dirname, resolve, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import type { LayoutSnapshot } from './layoutManager'

export interface MultiTermWorkspace {
  version: 1
  folders: Array<{ path: string }>
  layout: LayoutSnapshot | null
  expandedDirs: Record<string, string[]>
}

/** VS Code .code-workspace format */
interface VSCodeWorkspace {
  folders: Array<{ path: string; name?: string }>
  settings?: Record<string, unknown>
}

function isVSCodeWorkspace(data: unknown): data is VSCodeWorkspace {
  if (!data || typeof data !== 'object') return false
  const obj = data as Record<string, unknown>
  return Array.isArray(obj.folders) && !('version' in obj)
}

function convertVSCodeWorkspace(data: VSCodeWorkspace, wsFilePath: string): MultiTermWorkspace {
  const wsDir = dirname(wsFilePath)
  const folders = data.folders
    .map((f) => ({
      path: isAbsolute(f.path) ? f.path : resolve(wsDir, f.path)
    }))
    .filter((f) => existsSync(f.path))
  return {
    version: 1,
    folders,
    layout: null,
    expandedDirs: {}
  }
}

export async function loadWorkspaceFile(filePath: string): Promise<MultiTermWorkspace | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)

    // VS Code .code-workspace format
    if (isVSCodeWorkspace(parsed)) {
      return convertVSCodeWorkspace(parsed, filePath)
    }

    // Native .multiterm-workspace format
    const ws = parsed as MultiTermWorkspace
    if (ws.version !== 1) return null
    ws.folders = ws.folders.filter((f) => existsSync(f.path))
    return ws
  } catch {
    return null
  }
}

export async function saveWorkspaceFile(
  filePath: string,
  workspace: MultiTermWorkspace
): Promise<void> {
  const tmp = `${filePath}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(tmp, JSON.stringify(workspace, null, 2), 'utf-8')
    await rename(tmp, filePath)
  } catch {
    try { await unlink(tmp) } catch { /* ignore */ }
  }
}

export function saveWorkspaceFileSync(
  filePath: string,
  workspace: MultiTermWorkspace
): void {
  const tmp = `${filePath}.${randomUUID()}.tmp`
  try {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(tmp, JSON.stringify(workspace, null, 2), 'utf-8')
    renameSync(tmp, filePath)
  } catch {
    try { unlinkSync(tmp) } catch { /* ignore */ }
  }
}
