import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Clock, FileWarning, Layers, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import {
  groupFor,
  SCOPE_HINTS,
  SCOPE_LABELS,
  STARTUP_ONLY_KEYS,
  type ResolvedConfig,
  type ResolvedSetting,
  type Scope
} from '../../../shared/claudeConfig'
import type { RuleKind } from '../../../shared/permissionRules'
import { PermissionsSection } from './PermissionsSection'
import { HooksSection } from './HooksSection'
import { MemorySection } from './MemorySection'
import { ExtensionsSection } from './ExtensionsSection'

interface Props {
  /** The project whose `.claude` directory is being resolved. */
  cwd: string
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.length === 0 ? '[]' : value.map(formatValue).join(', ')
  return JSON.stringify(value)
}

function ScopeTag({ scope }: { scope: Scope }): React.JSX.Element {
  return (
    <span className={`config-scope config-scope--${scope}`} title={SCOPE_HINTS[scope]}>
      {SCOPE_LABELS[scope]}
    </span>
  )
}

function SettingRow({
  setting,
  onOpen
}: {
  setting: ResolvedSetting
  onOpen: (scope: Scope) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const merged = setting.mergeKind === 'merge'
  const additive = setting.mergeKind === 'additive'
  const startupOnly = STARTUP_ONLY_KEYS.has(setting.key.split('.')[0])

  return (
    <div className="config-row">
      <div className="config-row-main">
        <button
          className="config-row-key"
          onClick={() => onOpen(setting.winner)}
          title={`Open ${SCOPE_LABELS[setting.winner]} settings`}
        >
          {setting.key}
        </button>
        <span className="config-row-value">{formatValue(setting.value)}</span>
        {merged ? (
          <span className="config-scope config-scope--merged" title="Every scope contributes">
            <Layers size={9} strokeWidth={2} /> merged
          </span>
        ) : additive ? (
          // Every scope's hooks run together, so naming one winner would claim
          // the others had been switched off.
          <span
            className="config-scope config-scope--merged"
            title={`All of these run: ${(setting.contributors ?? []).map((s) => SCOPE_LABELS[s]).join(', ')}`}
          >
            <Layers size={9} strokeWidth={2} /> {setting.contributors?.length ?? 1} scopes, all live
          </span>
        ) : (
          <ScopeTag scope={setting.winner} />
        )}
      </div>

      <div className="config-row-notes">
        {startupOnly && (
          <span className="config-note" title="Claude Code reads this once, when a session starts">
            <Clock size={9} strokeWidth={1.5} /> applies to new sessions
          </span>
        )}
        {setting.shadowed.length > 0 && (
          <button className="config-shadow-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'hide' : `overrides ${setting.shadowed.length}`}
          </button>
        )}
      </div>

      {expanded &&
        setting.shadowed.map((source) => (
          <div key={source.scope} className="config-shadowed">
            <ScopeTag scope={source.scope} />
            <span className="config-shadowed-value">{formatValue(source.value)}</span>
          </div>
        ))}
    </div>
  )
}

/**
 * What Claude Code is actually configured to do in this project, and why.
 *
 * Opening a settings file answers almost nothing on its own: four scopes
 * combine, scalars replace while permission rules merge, and a file that fails
 * to parse is skipped without a word. This panel is the resolved result.
 */
export function ConfigPanel({ cwd }: Props): React.JSX.Element {
  const [config, setConfig] = useState<ResolvedConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fsRefreshKey = useProjectStore((s) => s.fsRefreshKey)
  const openFileInEditor = useProjectStore((s) => s.openFileInEditor)

  const [reloadKey, setReloadKey] = useState(0)

  // fsRefreshKey covers edits made outside the app — by you in an editor, or by
  // Claude Code itself while a session runs.
  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .claudeConfigLoad(cwd)
      .then((resolved) => {
        if (cancelled) return
        setConfig(resolved)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [cwd, fsRefreshKey, reloadKey])

  const load = useCallback(() => setReloadKey((k) => k + 1), [])

  const editRule = useCallback(
    async (scope: Scope, kind: RuleKind, rule: string, action: 'add' | 'remove') => {
      // The main process hands back the freshly resolved config, so the panel
      // shows the merged result rather than guessing at it.
      setConfig(await window.electronAPI.claudeConfigEditRule(cwd, scope, kind, rule, action))
    },
    [cwd]
  )

  const openScope = useCallback(
    (scope: Scope) => {
      const file = config?.files.find((f) => f.scope === scope)
      if (file?.exists) openFileInEditor(file.path)
    },
    [config, openFileInEditor]
  )

  const grouped = useMemo(() => {
    const groups = new Map<string, ResolvedSetting[]>()
    for (const setting of config?.settings ?? []) {
      const group = groupFor(setting.key)
      const bucket = groups.get(group)
      if (bucket) bucket.push(setting)
      else groups.set(group, [setting])
    }
    return [...groups.entries()].sort((a, b) => (a[0] === 'Other' ? 1 : b[0] === 'Other' ? -1 : 0))
  }, [config])

  if (error) return <div className="config-panel config-panel--error">{error}</div>
  if (!config) return <div className="config-panel config-panel--empty">Reading .claude…</div>

  const broken = config.files.filter((f) => f.parseError)
  // Excludes merge across scopes, so the resolver already has the full list.
  const excludeSetting = config.settings.find((s) => s.key === 'claudeMdExcludes')
  const excludes = Array.isArray(excludeSetting?.value)
    ? (excludeSetting.value as unknown[]).map(String)
    : []

  return (
    <div className="config-panel">
      <div className="config-header">
        <span className="config-title">Effective configuration</span>
        <button className="config-refresh" onClick={load} aria-label="Reload">
          <RefreshCw size={12} strokeWidth={1.5} />
        </button>
      </div>

      {broken.map((file) => (
        // Claude Code skips an unparseable settings file in silence, so this is
        // the only place the user finds out their rules never applied.
        <div key={file.path} className="config-broken">
          <AlertTriangle size={12} strokeWidth={1.5} />
          <div>
            <strong>{SCOPE_LABELS[file.scope]} settings are not valid JSON</strong>
            <p>Claude Code is ignoring this file entirely. {file.parseError}</p>
            <button className="config-broken-open" onClick={() => openFileInEditor(file.path)}>
              {file.path}
            </button>
          </div>
        </div>
      ))}

      <div className="config-files">
        {config.files.map((file) => (
          <button
            key={file.path}
            className={`config-file${file.exists ? '' : ' config-file--missing'}`}
            onClick={() => file.exists && openFileInEditor(file.path)}
            title={file.exists ? file.path : `${file.path} — not present`}
            disabled={!file.exists}
          >
            <ScopeTag scope={file.scope} />
            {!file.exists && <span className="config-file-missing-tag">absent</span>}
            {file.parseError && <FileWarning size={10} strokeWidth={2} />}
          </button>
        ))}
      </div>

      <PermissionsSection config={config} onEdit={editRule} />

      <HooksSection cwd={cwd} reloadKey={reloadKey + fsRefreshKey} onOpenFile={openFileInEditor} />

      <MemorySection
        cwd={cwd}
        reloadKey={reloadKey + fsRefreshKey}
        excludes={excludes}
        onOpenFile={openFileInEditor}
      />

      <ExtensionsSection
        cwd={cwd}
        reloadKey={reloadKey + fsRefreshKey}
        onOpenFile={openFileInEditor}
      />

      {config.settings.length === 0 ? (
        <p className="config-empty-note">
          No settings are defined in any scope. Claude Code is running entirely on its defaults.
        </p>
      ) : (
        grouped.map(([group, settings]) => (
          <section key={group} className="config-group">
            <h3 className="config-group-title">{group}</h3>
            {settings.map((setting) => (
              <SettingRow key={setting.key} setting={setting} onOpen={openScope} />
            ))}
          </section>
        ))
      )}
    </div>
  )
}
