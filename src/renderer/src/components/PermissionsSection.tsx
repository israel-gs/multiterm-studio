import { useMemo, useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import {
  SCOPE_HINTS,
  SCOPE_LABELS,
  type ResolvedConfig,
  type Scope
} from '../../../shared/claudeConfig'
import {
  evaluate,
  lintRule,
  type MatchResult,
  type PathContext,
  type RuleKind,
  type RuleWithScope
} from '../../../shared/permissionRules'

interface Props {
  config: ResolvedConfig
  /** Applies the change and hands back the freshly resolved configuration. */
  onEdit: (scope: Scope, kind: RuleKind, rule: string, action: 'add' | 'remove') => Promise<void>
}

const KINDS: RuleKind[] = ['deny', 'ask', 'allow']

/** Scopes the app writes to. Managed belongs to whoever deploys it. */
const WRITABLE: Scope[] = ['local', 'project', 'user']

const VERDICT_LABEL: Record<MatchResult['verdict'], string> = {
  deny: 'Blocked',
  ask: 'Asks you',
  allow: 'Runs without asking',
  prompt: 'Asks you'
}

/**
 * The permission rules of every scope, merged, plus a tester.
 *
 * Debugging permissions today means provoking the agent and watching what it
 * does. The tester answers the same question directly, and the linter catches
 * the rules Claude Code accepts and then never consults.
 */
export function PermissionsSection({ config, onEdit }: Props): React.JSX.Element {
  const [tool, setTool] = useState('Bash')
  const [argument, setArgument] = useState('')
  const [draft, setDraft] = useState('')
  const [draftKind, setDraftKind] = useState<RuleKind>('allow')
  const [draftScope, setDraftScope] = useState<Scope>('local')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rules: RuleWithScope[] = useMemo(
    () =>
      config.permissions.map((p) => ({
        rule: p.rule,
        kind: p.kind,
        // A `/pattern` anchors at its own scope's source, not the project's.
        settingsBase: p.scope === 'user' ? undefined : config.folderPath
      })),
    [config]
  )

  const ctx: PathContext = useMemo(
    () => ({ cwd: config.folderPath, settingsBase: config.folderPath, home: config.home }),
    [config.folderPath, config.home]
  )

  const verdict = argument.trim() ? evaluate({ tool, argument: argument.trim() }, rules, ctx) : null

  const warnings = useMemo(
    () => config.permissions.flatMap((p) => lintRule(p.rule, p.kind)),
    [config.permissions]
  )

  async function run(
    scope: Scope,
    kind: RuleKind,
    rule: string,
    action: 'add' | 'remove'
  ): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await onEdit(scope, kind, rule, action)
      if (action === 'add') setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="config-group">
      <h3 className="config-group-title">Permissions</h3>

      {/* Tester — the question you actually have */}
      <div className="perm-tester">
        <div className="perm-tester-inputs">
          <select
            className="perm-select"
            value={tool}
            onChange={(e) => setTool(e.target.value)}
            aria-label="Tool"
          >
            {['Bash', 'Read', 'Edit', 'WebFetch', 'Agent'].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            className="perm-input"
            value={argument}
            placeholder={
              tool === 'Bash'
                ? 'git push origin main'
                : tool === 'WebFetch'
                  ? 'example.com'
                  : '/repo/.env'
            }
            onChange={(e) => setArgument(e.target.value)}
            aria-label="Command or path to test"
          />
        </div>

        {verdict && (
          <div className={`perm-verdict perm-verdict--${verdict.verdict}`}>
            <strong>{VERDICT_LABEL[verdict.verdict]}</strong>
            <span>{verdict.reason}</span>
            {verdict.caveat && <em className="perm-caveat">{verdict.caveat}</em>}
          </div>
        )}
      </div>

      {/* Rules that never fire */}
      {warnings.map((warning, i) => (
        <div key={`${warning.rule}-${i}`} className="perm-warning">
          <AlertTriangle size={11} strokeWidth={1.5} />
          <div>
            <code>{warning.rule}</code>
            <p>{warning.message}</p>
          </div>
        </div>
      ))}

      {/* The merged rules */}
      {KINDS.map((kind) => {
        const list = config.permissions.filter((p) => p.kind === kind)
        if (list.length === 0) return null
        return (
          <div key={kind} className="perm-list">
            <span className={`perm-kind perm-kind--${kind}`}>{kind}</span>
            {list.map((p, i) => (
              <div key={`${p.rule}-${p.scope}-${i}`} className="perm-rule">
                <code className="perm-rule-text">{p.rule}</code>
                <span
                  className={`config-scope config-scope--${p.scope}`}
                  title={SCOPE_HINTS[p.scope]}
                >
                  {SCOPE_LABELS[p.scope]}
                </span>
                {p.scope !== 'managed' && (
                  <button
                    className="perm-remove"
                    disabled={busy}
                    onClick={() => void run(p.scope, kind, p.rule, 'remove')}
                    title={`Remove from ${SCOPE_LABELS[p.scope]} settings`}
                    aria-label={`Remove ${p.rule}`}
                  >
                    <Trash2 size={10} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      })}

      {/* Add a rule */}
      <div className="perm-add">
        <select
          className="perm-select"
          value={draftKind}
          onChange={(e) => setDraftKind(e.target.value as RuleKind)}
          aria-label="Rule kind"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <input
          className="perm-input"
          value={draft}
          placeholder="Bash(npm run test:*)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim())
              void run(draftScope, draftKind, draft.trim(), 'add')
          }}
          aria-label="New rule"
        />
        <select
          className="perm-select"
          value={draftScope}
          onChange={(e) => setDraftScope(e.target.value as Scope)}
          aria-label="Scope to write to"
          title={SCOPE_HINTS[draftScope]}
        >
          {WRITABLE.map((s) => (
            <option key={s} value={s}>
              {SCOPE_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          className="perm-add-btn"
          disabled={busy || !draft.trim()}
          onClick={() => void run(draftScope, draftKind, draft.trim(), 'add')}
        >
          <Plus size={11} strokeWidth={2} /> Add
        </button>
      </div>

      {draft.trim() &&
        lintRule(draft.trim(), draftKind).map((warning, i) => (
          // Caught before it is written, rather than after it silently fails.
          <p key={i} className="perm-draft-warning">
            {warning.message}
          </p>
        ))}

      {draftScope === 'project' && (
        <p className="perm-scope-note">
          Project settings are committed — this rule reaches everyone on the team.
        </p>
      )}

      {error && <p className="perm-error">{error}</p>}
    </section>
  )
}
