import { mkdir, writeFile, readFile, appendFile } from 'fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface PanelEntry {
  id: string
  title: string
  color: string
}

export interface LayoutSnapshot {
  version: 1
  tree: unknown // MosaicNode<string> | null — stored as plain JSON
  panels: PanelEntry[]
}

function layoutPath(folderPath: string): string {
  return join(folderPath, '.multiterm', 'layout.json')
}

function multitermDir(folderPath: string): string {
  return join(folderPath, '.multiterm')
}

/**
 * Async save: creates .multiterm/ dir if missing, writes layout.json.
 * Silently fails on any error (never throws).
 */
export async function saveLayout(folderPath: string, layout: LayoutSnapshot): Promise<void> {
  try {
    await mkdir(multitermDir(folderPath), { recursive: true })
    await writeFile(layoutPath(folderPath), JSON.stringify(layout, null, 2))
  } catch {
    // Silent failure — do not crash the app on save errors
  }
}

/**
 * Synchronous save for before-quit handler. Creates dir if missing, writes layout.json.
 * Silently fails on any error.
 */
export function saveLayoutSync(folderPath: string, layout: LayoutSnapshot): void {
  try {
    mkdirSync(multitermDir(folderPath), { recursive: true })
    writeFileSync(layoutPath(folderPath), JSON.stringify(layout, null, 2))
  } catch {
    // Silent failure
  }
}

/**
 * Loads layout from .multiterm/layout.json.
 * Returns null if file is missing (ENOENT) or contains invalid JSON.
 */
export async function loadLayout(folderPath: string): Promise<LayoutSnapshot | null> {
  try {
    const raw = await readFile(layoutPath(folderPath), 'utf-8')
    return JSON.parse(raw) as LayoutSnapshot
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
