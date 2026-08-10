import { readFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import type { HookEntry, HookReport, HookRun } from '../shared/claudeHooks'
import type { Scope } from '../shared/claudeConfig'
import { SCOPE_ORDER } from '../shared/claudeConfig'

const HOOK_MARKER = 'multiterm-studio'
const LOG_PATH = join(homedir(), '.multiterm-studio', 'hook-log.jsonl')

function settingsPath(scope: Scope, folderPath: string): string | null {
  switch (scope) {
    case 'user':
      return join(homedir(), '.claude', 'settings.json')
    case 'project':
      return join(folderPath, '.claude', 'settings.json')
    case 'local':
      return join(folderPath, '.claude', 'settings.local.json')
    default:
      // Managed hooks exist, but the panel already reports the file itself and
      // reading it is not something a user action should depend on.
      return null
  }
}

async function readSettings(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Flattens one scope's `hooks` block into individual commands. */
function entriesFrom(settings: Record<string, unknown>, scope: Scope): HookEntry[] {
  const hooks = settings.hooks
  if (!hooks || typeof hooks !== 'object') return []

  const entries: HookEntry[] = []
  for (const [event, group] of Object.entries(hooks as Record<string, unknown>)) {
    if (!Array.isArray(group)) continue
    for (const item of group) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const commands = Array.isArray(record.hooks) ? record.hooks : []
      for (const command of commands) {
        if (!command || typeof command !== 'object') continue
        const spec = command as Record<string, unknown>
        entries.push({
          event,
          ...(typeof record.matcher === 'string' ? { matcher: record.matcher } : {}),
          command: String(spec.command ?? ''),
          ...(typeof spec.timeout === 'number' ? { timeout: spec.timeout } : {}),
          scope,
          ours: record._source === HOOK_MARKER
        })
      }
    }
  }
  return entries
}

/** The last runs the hook script recorded, most recent first. */
async function readRuns(limit: number): Promise<HookRun[]> {
  let raw: string
  try {
    raw = await readFile(LOG_PATH, 'utf-8')
  } catch {
    return []
  }

  const runs: HookRun[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as HookRun
      if (typeof parsed.at === 'number') runs.push(parsed)
    } catch {
      // A torn line from a concurrent append — skip it rather than give up.
    }
  }
  return runs.reverse().slice(0, limit)
}

/**
 * Every hook registered for this project, with the runs the app's own hook
 * recorded.
 *
 * Hooks merge across scopes and all of them fire, so this is a list rather than
 * a resolution: there is no winner to pick.
 */
export async function resolveHooks(folderPath: string): Promise<HookReport> {
  const entries: HookEntry[] = []
  let disabledBy: Scope | undefined

  for (const scope of SCOPE_ORDER) {
    const path = settingsPath(scope, folderPath)
    if (!path) continue
    const settings = await readSettings(path)
    if (!settings) continue
    // Reported rather than folded in: with this on, nothing below runs at all.
    if (settings.disableAllHooks === true && !disabledBy) disabledBy = scope
    entries.push(...entriesFrom(settings, scope))
  }

  return {
    entries,
    runs: await readRuns(60),
    ...(disabledBy ? { disabledBy } : {})
  }
}
