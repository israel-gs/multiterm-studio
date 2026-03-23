import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'

let settings: Record<string, unknown> = {}
let settingsPath = ''

export function initSettings(): void {
  settingsPath = join(app.getPath('userData'), 'settings.json')
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
  } catch {
    settings = {}
  }
}

export function getSetting(key: string): unknown {
  return settings[key] ?? null
}

export function setSetting(key: string, value: unknown): void {
  settings[key] = value
  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    const tmp = `${settingsPath}.${randomUUID()}.tmp`
    writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
    renameSync(tmp, settingsPath)
  } catch {
    // silent
  }
}
