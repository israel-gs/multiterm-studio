import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { SCOPE_HINTS, SCOPE_LABELS } from '../../../shared/claudeConfig'
import { sortEvents, type HookReport } from '../../../shared/claudeHooks'

interface Props {
  cwd: string
  reloadKey: number
  onOpenFile: (path: string) => void
}

function when(at: number): string {
  const seconds = Math.floor((Date.now() - at) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

/**
 * Every hook registered for this project, and what the app's own hook actually
 * did the last time it fired.
 *
 * Hooks merge across scopes and all of them run, so there is no winner to pick
 * — the value here is knowing which of them are yours, which Multiterm put
 * there, and whether they are failing. A failing hook is silent otherwise.
 */
export function HooksSection({ cwd, reloadKey, onOpenFile }: Props): React.JSX.Element | null {
  const [report, setReport] = useState<HookReport | null>(null)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .claudeConfigHooks(cwd)
      .then((result) => {
        if (!cancelled) setReport(result)
      })
      .catch(() => {
        if (!cancelled) setReport(null)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, reloadKey])

  if (!report || (report.entries.length === 0 && report.runs.length === 0)) return null

  const events = sortEvents([...new Set(report.entries.map((e) => e.event))])
  const failures = report.runs.filter((run) => run.error)

  return (
    <section className="config-group">
      <h3 className="config-group-title">Hooks</h3>

      {report.disabledBy && (
        <div className="perm-warning">
          <AlertTriangle size={11} strokeWidth={1.5} />
          <div>
            <strong>disableAllHooks is on in {SCOPE_LABELS[report.disabledBy]} settings.</strong>
            <p>None of the hooks below run, including the ones Multiterm installs.</p>
          </div>
        </div>
      )}

      {failures.length > 0 && (
        <div className="perm-warning">
          <AlertTriangle size={11} strokeWidth={1.5} />
          <div>
            <strong>
              {failures.length} recent failure{failures.length > 1 ? 's' : ''}
            </strong>
            <p>{failures[0].error}</p>
          </div>
        </div>
      )}

      {events.map((event) => (
        <div key={event} className="hook-event">
          <span className="hook-event-name">{event}</span>
          {report.entries
            .filter((entry) => entry.event === event)
            .map((entry, i) => (
              <div key={`${entry.command}-${i}`} className="hook-entry">
                {entry.matcher && <code className="hook-matcher">{entry.matcher}</code>}
                <code className="hook-command" title={entry.command}>
                  {entry.command}
                </code>
                {entry.ours && (
                  <span className="hook-ours" title="Installed by Multiterm Studio">
                    Multiterm
                  </span>
                )}
                <span
                  className={`config-scope config-scope--${entry.scope}`}
                  title={SCOPE_HINTS[entry.scope]}
                >
                  {SCOPE_LABELS[entry.scope]}
                </span>
              </div>
            ))}
        </div>
      ))}

      {report.runs.length > 0 && (
        <>
          <button
            className="config-shadow-toggle hook-log-toggle"
            onClick={() => setShowLog((v) => !v)}
          >
            {showLog ? 'hide run log' : `run log — ${report.runs.length} recent firings`}
          </button>

          {showLog && (
            <div className="hook-log">
              {report.runs.map((run, i) => (
                <div
                  key={`${run.at}-${i}`}
                  className={`hook-run${run.error ? ' hook-run--error' : ''}`}
                >
                  {run.error ? (
                    <XCircle size={10} strokeWidth={2} />
                  ) : (
                    <CheckCircle2 size={10} strokeWidth={2} />
                  )}
                  <span className="hook-run-event">{run.event}</span>
                  {run.tool && <span className="hook-run-tool">{run.tool}</span>}
                  {run.injected && (
                    <span className="hook-run-injected" title="Added context to the session">
                      injected
                    </span>
                  )}
                  <span className="hook-run-meta">
                    {run.ms}ms · {when(run.at)}
                  </span>
                  {run.error && <span className="hook-run-error">{run.error}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p className="hook-note">
        Hooks are not resolved: every scope&apos;s entries run together. Edit them in{' '}
        <button
          className="config-broken-open"
          onClick={() => onOpenFile(`${cwd}/.claude/settings.local.json`)}
        >
          settings.local.json
        </button>
        .
      </p>
    </section>
  )
}
