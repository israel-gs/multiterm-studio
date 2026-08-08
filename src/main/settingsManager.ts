import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import { reportError } from './errorReporter'
import { SCROLLBACK_DEFAULT_BYTES, clampScrollbackBytes } from '../shared/scrollback'

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
  } catch (err) {
    reportError('settings-save', 'Could not save your settings', err)
  }
}

// --- Scrollback setting ---

export {
  SCROLLBACK_DEFAULT_BYTES as SCROLLBACK_DEFAULT,
  SCROLLBACK_MIN_BYTES as SCROLLBACK_MIN,
  SCROLLBACK_MAX_BYTES as SCROLLBACK_MAX
} from '../shared/scrollback'

/**
 * Returns the configured scrollback buffer size in bytes, clamped to
 * the supported range. Falls back to the default when
 * the setting is unset or not a number.
 */
export function getScrollbackBytes(): number {
  const raw = getSetting('terminal.scrollbackBytes')
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return SCROLLBACK_DEFAULT_BYTES
  }
  return clampScrollbackBytes(raw)
}

/**
 * Persists the scrollback buffer size. Value is clamped to
 * the supported range before storage.
 */
export function setScrollbackBytes(bytes: number): void {
  setSetting('terminal.scrollbackBytes', clampScrollbackBytes(bytes))
}
