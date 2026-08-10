/**
 * The shape of Claude Code's own configuration, resolved across its scopes.
 *
 * Reading one settings file answers almost nothing: the scopes combine by two
 * different rules. Scalars are replaced by the higher scope, while permission
 * rules and `claudeMdExcludes` are merged across all of them. What is actually
 * in force is a computed thing, and this module is its vocabulary.
 */

/** Ordered from lowest precedence to highest. */
export const SCOPE_ORDER = ['user', 'project', 'local', 'managed'] as const

export type Scope = (typeof SCOPE_ORDER)[number]

export const SCOPE_LABELS: Record<Scope, string> = {
  user: 'User',
  project: 'Project',
  local: 'Local',
  managed: 'Managed'
}

export const SCOPE_HINTS: Record<Scope, string> = {
  user: '~/.claude/settings.json — you, in every project',
  project: '.claude/settings.json — committed, shared with the team',
  local: '.claude/settings.local.json — you, in this repo only',
  managed: 'Deployed by your organisation; cannot be overridden'
}

/** One settings file on disk, and what became of it. */
export interface ScopeFile {
  scope: Scope
  path: string
  exists: boolean
  /**
   * Set when the file exists but could not be parsed.
   *
   * Claude Code ignores a malformed settings file in silence, which is a long
   * afternoon of wondering why a rule does not apply. Surfacing it is half the
   * value of this panel.
   */
  parseError?: string
}

/** Where a value came from. */
export interface SettingSource {
  scope: Scope
  value: unknown
}

export interface ResolvedSetting {
  key: string
  /** The value in force. */
  value: unknown
  winner: Scope
  /** The values this one covers, highest precedence first. */
  shadowed: SettingSource[]
  /**
   * `merge` means every scope contributed rather than the top one winning.
   * `additive` is for hooks: every scope's entries run, but they are objects
   * keyed by event rather than one array to concatenate.
   */
  mergeKind: 'replace' | 'merge' | 'additive'
  /** For `additive` keys, which scopes contributed — all of them are live. */
  contributors?: Scope[]
}

/** A single permission rule, and the scope that contributed it. */
export interface PermissionRule {
  rule: string
  kind: 'allow' | 'deny' | 'ask'
  scope: Scope
}

export interface ResolvedConfig {
  folderPath: string
  /** The real home directory, so `~/…` rules can be resolved in the renderer. */
  home: string
  files: ScopeFile[]
  settings: ResolvedSetting[]
  /** Every rule from every scope, merged — deny beats allow at match time. */
  permissions: PermissionRule[]
}

/**
 * Keys whose arrays merge across scopes instead of being replaced.
 *
 * Everything else follows the ordinary "highest scope wins" rule.
 */
export const MERGED_KEYS = new Set([
  'permissions.allow',
  'permissions.deny',
  'permissions.ask',
  'claudeMdExcludes'
])

/**
 * Keys where every scope's entries stay live, but the value is an object rather
 * than an array.
 *
 * Hooks are the case: "hook entries merge across settings levels rather than
 * replacing each other", and all matching hooks run in parallel. Showing the
 * top scope as the winner here would claim the user's own hooks had been
 * switched off, which is the opposite of what happens.
 */
export const ADDITIVE_KEYS = new Set(['hooks'])

/**
 * Settings Claude Code only reads when a session starts.
 *
 * Editing one of these and watching nothing happen is confusing enough to be
 * worth a warning next to the value.
 */
export const STARTUP_ONLY_KEYS = new Set([
  'model',
  'fallbackModel',
  'availableModels',
  'outputStyle',
  'env',
  'apiKeyHelper',
  'statusLine',
  'defaultShell'
])

/** Groups for the panel, so 40 keys do not arrive as one flat list. */
export const SETTING_GROUPS: Array<{ title: string; match: (key: string) => boolean }> = [
  {
    title: 'Model',
    match: (k) =>
      /^(model|fallbackModel|availableModels|effortLevel|advisorModel|alwaysThinkingEnabled|fastMode)/.test(
        k
      )
  },
  { title: 'Permissions', match: (k) => k.startsWith('permissions') || k.includes('Permission') },
  { title: 'Hooks', match: (k) => k.toLowerCase().includes('hook') },
  { title: 'MCP', match: (k) => k.toLowerCase().includes('mcp') },
  { title: 'Context and memory', match: (k) => /^(autoCompact|autoMemory|claudeMd)/.test(k) },
  { title: 'Environment', match: (k) => /^(env|apiKeyHelper|aws|defaultShell)/.test(k) }
]

export function groupFor(key: string): string {
  return SETTING_GROUPS.find((g) => g.match(key))?.title ?? 'Other'
}
