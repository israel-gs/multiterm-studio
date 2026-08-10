import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { homedir, platform } from 'os'
import {
  ADDITIVE_KEYS,
  MERGED_KEYS,
  SCOPE_ORDER,
  type PermissionRule,
  type ResolvedConfig,
  type ResolvedSetting,
  type Scope,
  type ScopeFile,
  type SettingSource
} from '../shared/claudeConfig'

/** Where an organisation deploys settings every user on the machine inherits. */
function managedSettingsPath(): string {
  switch (platform()) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/managed-settings.json'
    case 'win32':
      return 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
    default:
      return '/etc/claude-code/managed-settings.json'
  }
}

function scopePath(scope: Scope, folderPath: string): string {
  switch (scope) {
    case 'user':
      return join(homedir(), '.claude', 'settings.json')
    case 'project':
      return join(folderPath, '.claude', 'settings.json')
    case 'local':
      return join(folderPath, '.claude', 'settings.local.json')
    case 'managed':
      return managedSettingsPath()
  }
}

interface LoadedScope {
  file: ScopeFile
  settings: Record<string, unknown>
}

async function loadScope(scope: Scope, folderPath: string): Promise<LoadedScope> {
  const path = scopePath(scope, folderPath)
  let raw: string
  try {
    raw = await readFile(path, 'utf-8')
  } catch {
    // Missing is the ordinary case, and is information rather than a gap.
    return { file: { scope, path, exists: false }, settings: {} }
  }

  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        file: { scope, path, exists: true, parseError: 'Expected a JSON object' },
        settings: {}
      }
    }
    return { file: { scope, path, exists: true }, settings: parsed as Record<string, unknown> }
  } catch (err) {
    // Claude Code skips a file it cannot parse without saying so.
    return {
      file: {
        scope,
        path,
        exists: true,
        parseError: err instanceof Error ? err.message : String(err)
      },
      settings: {}
    }
  }
}

/**
 * Flattens one level deep, so `permissions.allow` is addressable on its own.
 *
 * It has to be: that key merges across scopes while its siblings do not, and a
 * whole-object comparison would hide which scope contributed which rule.
 */
function flatten(settings: Record<string, unknown>): Map<string, unknown> {
  const flat = new Map<string, unknown>()
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'permissions' && value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [sub, subValue] of Object.entries(value as Record<string, unknown>)) {
        flat.set(`permissions.${sub}`, subValue)
      }
      continue
    }
    flat.set(key, value)
  }
  return flat
}

/**
 * Resolves every scope into the configuration actually in force.
 *
 * Two rules, not one: scalars are replaced by the highest scope that sets them,
 * while the keys in MERGED_KEYS collect contributions from all of them.
 */
export async function resolveClaudeConfig(folderPath: string): Promise<ResolvedConfig> {
  const loaded = await Promise.all(SCOPE_ORDER.map((scope) => loadScope(scope, folderPath)))
  const flats = loaded.map((entry) => flatten(entry.settings))

  const keys = new Set<string>()
  for (const flat of flats) for (const key of flat.keys()) keys.add(key)

  const settings: ResolvedSetting[] = []
  for (const key of [...keys].sort()) {
    // Highest precedence first, which is the order the panel shows them in.
    const contributors: SettingSource[] = []
    for (let i = flats.length - 1; i >= 0; i--) {
      if (flats[i].has(key)) contributors.push({ scope: SCOPE_ORDER[i], value: flats[i].get(key) })
    }
    if (contributors.length === 0) continue

    if (ADDITIVE_KEYS.has(key)) {
      // Every scope's hooks stay live and run together, so nothing is shadowed.
      settings.push({
        key,
        value: contributors[0].value,
        winner: contributors[0].scope,
        shadowed: [],
        mergeKind: 'additive',
        contributors: contributors.map((c) => c.scope)
      })
      continue
    }

    if (MERGED_KEYS.has(key)) {
      // Lowest scope first, matching the order the rules are read in.
      const merged: unknown[] = []
      for (const source of [...contributors].reverse()) {
        if (Array.isArray(source.value)) merged.push(...source.value)
      }
      settings.push({
        key,
        value: merged,
        winner: contributors[0].scope,
        shadowed: [],
        mergeKind: 'merge'
      })
      continue
    }

    settings.push({
      key,
      value: contributors[0].value,
      winner: contributors[0].scope,
      shadowed: contributors.slice(1),
      mergeKind: 'replace'
    })
  }

  return {
    folderPath,
    home: homedir(),
    files: loaded.map((entry) => entry.file),
    settings,
    permissions: collectPermissions(flats)
  }
}

/** Every permission rule with the scope that contributed it, duplicates kept. */
function collectPermissions(flats: Array<Map<string, unknown>>): PermissionRule[] {
  const rules: PermissionRule[] = []
  for (const kind of ['deny', 'ask', 'allow'] as const) {
    flats.forEach((flat, i) => {
      const value = flat.get(`permissions.${kind}`)
      if (!Array.isArray(value)) return
      for (const rule of value) {
        if (typeof rule === 'string' && rule) rules.push({ rule, kind, scope: SCOPE_ORDER[i] })
      }
    })
  }
  return rules
}

/**
 * Adds or removes a permission rule in one scope.
 *
 * Writes stay inside the scope the caller names, and the file is rewritten
 * whole so nothing else in it is disturbed. `managed` is refused: it belongs to
 * whoever deploys it, and editing it here would be quietly undone anyway.
 */
export async function editPermissionRule(
  folderPath: string,
  scope: Scope,
  kind: 'allow' | 'deny' | 'ask',
  rule: string,
  action: 'add' | 'remove'
): Promise<ResolvedConfig> {
  if (scope === 'managed') throw new Error('Managed settings are deployed by your organisation')

  const path = scopePath(scope, folderPath)
  const { file, settings } = await loadScope(scope, folderPath)
  // Refusing to touch a file we could not parse: rewriting it would throw away
  // whatever the user was in the middle of writing.
  if (file.parseError) throw new Error(`${path} is not valid JSON — fix it first`)

  const permissions = (
    settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {}
  ) as Record<string, unknown>
  const list = Array.isArray(permissions[kind]) ? [...(permissions[kind] as string[])] : []

  if (action === 'add') {
    if (!list.includes(rule)) list.push(rule)
  } else {
    const index = list.indexOf(rule)
    if (index !== -1) list.splice(index, 1)
  }

  if (list.length > 0) permissions[kind] = list
  else delete permissions[kind]

  if (Object.keys(permissions).length > 0) settings.permissions = permissions
  else delete settings.permissions

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(settings, null, 2) + '\n', 'utf-8')
  return resolveClaudeConfig(folderPath)
}

/** The files to watch so the panel notices an edit made outside the app. */
export function claudeConfigPaths(folderPath: string): string[] {
  return SCOPE_ORDER.map((scope) => scopePath(scope, folderPath))
}
