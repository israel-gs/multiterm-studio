import { mkdir, writeFile, rename, readFile, appendFile, unlink } from 'fs/promises'
import { existsSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

export interface PanelEntry {
  id: string
  title: string
  color: string
  type?: 'terminal' | 'editor' | 'note' | 'image'
  filePath?: string
}

export interface CardRect {
  x: number
  y: number
  w: number
  h: number
  z: number
}

export interface LayoutSnapshotV1 {
  version: 1
  tree: unknown // MosaicNode<string> | null — stored as plain JSON
  panels: PanelEntry[]
}

export interface LayoutSnapshotV2 {
  version: 2
  panelIds: string[]
  panels: PanelEntry[]
}

export interface LayoutSnapshotV3 {
  version: 3
  panelIds: string[]
  panels: PanelEntry[]
  positions: Record<string, CardRect>
}

export type LayoutSnapshot = LayoutSnapshotV1 | LayoutSnapshotV2 | LayoutSnapshotV3

function layoutPath(folderPath: string): string {
  return join(folderPath, '.multiterm', 'layout.json')
}

function multitermDir(folderPath: string): string {
  return join(folderPath, '.multiterm')
}

function extractLeafIds(node: unknown): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === 'string') return [node]
  if (typeof node === 'object' && node !== null) {
    const obj = node as Record<string, unknown>
    if (Array.isArray(obj.children)) {
      return obj.children.flatMap((child: unknown) => extractLeafIds(child))
    }
    if (obj.first !== undefined || obj.second !== undefined) {
      return [...extractLeafIds(obj.first), ...extractLeafIds(obj.second)]
    }
  }
  return []
}

function migrateV1toV2(v1: LayoutSnapshotV1): LayoutSnapshotV2 {
  let panelIds = extractLeafIds(v1.tree)
  if (panelIds.length === 0) {
    panelIds = v1.panels.map((p) => p.id)
  }
  return { version: 2, panelIds, panels: v1.panels }
}

function migrateV2toV3(v2: LayoutSnapshotV2): LayoutSnapshotV3 {
  const positions: Record<string, CardRect> = {}
  v2.panelIds.forEach((id, i) => {
    positions[id] = {
      x: 40 + i * 30,
      y: 40 + i * 30,
      w: 480,
      h: 320,
      z: i + 1
    }
  })
  return { version: 3, panelIds: v2.panelIds, panels: v2.panels, positions }
}

/**
 * Async save: creates .multiterm/ dir if missing, writes layout.json.
 * Silently fails on any error (never throws).
 */
export async function saveLayout(folderPath: string, layout: LayoutSnapshot): Promise<void> {
  const targetPath = layoutPath(folderPath)
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`
  try {
    await mkdir(multitermDir(folderPath), { recursive: true })
    await writeFile(tmpPath, JSON.stringify(layout, null, 2))
    await rename(tmpPath, targetPath)
  } catch {
    // Silent failure — do not crash the app on save errors
    try {
      await unlink(tmpPath)
    } catch {
      /* ignore cleanup errors */
    }
  }
}

/**
 * Synchronous save for before-quit handler. Creates dir if missing, writes layout.json.
 * Silently fails on any error.
 */
export function saveLayoutSync(folderPath: string, layout: LayoutSnapshot): void {
  const targetPath = layoutPath(folderPath)
  const tmpPath = `${targetPath}.${randomUUID()}.tmp`
  try {
    mkdirSync(multitermDir(folderPath), { recursive: true })
    writeFileSync(tmpPath, JSON.stringify(layout, null, 2))
    renameSync(tmpPath, targetPath)
  } catch {
    // Silent failure
    try {
      unlinkSync(tmpPath)
    } catch {
      /* ignore cleanup errors */
    }
  }
}

/**
 * Loads layout from .multiterm/layout.json.
 * Returns null if file is missing (ENOENT) or contains invalid JSON.
 * Automatically migrates v1 (mosaic tree) to v2 (flat array) format.
 */
export async function loadLayout(folderPath: string): Promise<LayoutSnapshot | null> {
  try {
    const raw = await readFile(layoutPath(folderPath), 'utf-8')
    const parsed = JSON.parse(raw) as LayoutSnapshot
    if (parsed.version === 1) {
      return migrateV2toV3(migrateV1toV2(parsed as LayoutSnapshotV1))
    }
    if (parsed.version === 2) {
      return migrateV2toV3(parsed as LayoutSnapshotV2)
    }
    return parsed
  } catch {
    return null
  }
}

/**
 * Appends ".multiterm/" to .gitignore if the file exists and doesn't already contain it.
 * No-op if .gitignore is absent or already has .multiterm entry.
 */
export async function ensureGitignore(folderPath: string): Promise<void> {
  const gitignorePath = join(folderPath, '.gitignore')
  if (!existsSync(gitignorePath)) return
  try {
    const contents = await readFile(gitignorePath, 'utf-8')
    if (contents.includes('.multiterm')) return
    await appendFile(gitignorePath, '\n# Multiterm Studio local config\n.multiterm/\n')
  } catch {
    // Silent failure
  }
}
