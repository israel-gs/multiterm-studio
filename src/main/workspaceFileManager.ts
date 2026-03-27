import { mkdir, writeFile, rename, readFile, unlink } from 'fs/promises'
import { mkdirSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { LayoutSnapshot } from './layoutManager'

export interface MultiTermWorkspace {
  version: 1
  folders: Array<{ path: string }>
  layout: LayoutSnapshot | null
  expandedDirs: Record<string, string[]>
}

export async function loadWorkspaceFile(filePath: string): Promise<MultiTermWorkspace | null> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as MultiTermWorkspace
    if (parsed.version !== 1) return null
    // Filter out folders that no longer exist
    parsed.folders = parsed.folders.filter((f) => existsSync(f.path))
    return parsed
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
