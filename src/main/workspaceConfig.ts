import { readFile, writeFile, rename, mkdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'

export interface WorkspaceConfig {
  selected_file: string | null
  expanded_dirs: string[]
}

const DEFAULT_CONFIG: WorkspaceConfig = {
  selected_file: null,
  expanded_dirs: []
}

function configPath(folderPath: string): string {
  return join(folderPath, '.multiterm', 'workspace.json')
}

export async function loadWorkspaceConfig(folderPath: string): Promise<WorkspaceConfig> {
  try {
    const raw = await readFile(configPath(folderPath), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceConfig>
    return {
      selected_file: parsed.selected_file ?? null,
      expanded_dirs: Array.isArray(parsed.expanded_dirs) ? parsed.expanded_dirs : []
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export async function saveWorkspaceConfig(
  folderPath: string,
  config: WorkspaceConfig
): Promise<void> {
  const target = configPath(folderPath)
  const tmp = `${target}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(config, null, 2), 'utf-8')
    await rename(tmp, target)
  } catch {
    try { await unlink(tmp) } catch { /* ignore */ }
  }
}
