import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
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

// --- Scrollback setting ---

/** Default scrollback buffer size: 8 MB. */
export const SCROLLBACK_DEFAULT = 8 * 1024 * 1024

/** Minimum scrollback buffer size: 16 KB. */
export const SCROLLBACK_MIN = 16 * 1024

/** Maximum scrollback buffer size: 64 MB. */
export const SCROLLBACK_MAX = 64 * 1024 * 1024

/**
 * Returns the configured scrollback buffer size in bytes, clamped to
 * [SCROLLBACK_MIN, SCROLLBACK_MAX]. Falls back to SCROLLBACK_DEFAULT when
 * the setting is unset or not a number.
 */
export function getScrollbackBytes(): number {
  const raw = getSetting('terminal.scrollbackBytes')
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return SCROLLBACK_DEFAULT
  }
  return Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, raw))
}

/**
 * Persists the scrollback buffer size. Value is clamped to
 * [SCROLLBACK_MIN, SCROLLBACK_MAX] before storage.
 */
export function setScrollbackBytes(bytes: number): void {
  const clamped = Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, bytes))
  setSetting('terminal.scrollbackBytes', clamped)
}
