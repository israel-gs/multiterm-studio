import { useEffect, useState } from 'react'
import { HelpCircle, Plug } from 'lucide-react'
import {
  EXTENSION_LABELS,
  type ExtensionKind,
  type ExtensionReport
} from '../../../shared/claudeExtensions'

interface Props {
  cwd: string
  reloadKey: number
  onOpenFile: (path: string) => void
}

const KINDS: ExtensionKind[] = ['skill', 'agent', 'command']

/** Skills, subagents, commands and MCP servers this project brings along. */
export function ExtensionsSection({ cwd, reloadKey, onOpenFile }: Props): React.JSX.Element | null {
  const [report, setReport] = useState<ExtensionReport | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .claudeConfigExtensions(cwd)
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

  if (!report || (report.extensions.length === 0 && report.mcpServers.length === 0)) return null

  return (
    <section className="config-group">
      <h3 className="config-group-title">Extensions</h3>

      {KINDS.map((kind) => {
        const list = report.extensions.filter((e) => e.kind === kind)
        if (list.length === 0) return null
        return (
          <div key={kind} className="ext-group">
            <span className="ext-kind">{EXTENSION_LABELS[kind]}</span>
            {list.map((extension) => (
              <div key={extension.path} className="ext-row">
                <button
                  className="ext-name"
                  onClick={() => onOpenFile(extension.path)}
                  title={extension.path}
                >
                  {extension.name}
                </button>
                {extension.description && (
                  <span className="ext-description">{extension.description}</span>
                )}
                <span className="config-scope">
                  {extension.origin === 'user' ? 'User' : 'Project'}
                </span>
              </div>
            ))}
          </div>
        )
      })}

      {report.mcpServers.length > 0 && (
        <div className="ext-group">
          <span className="ext-kind">MCP servers</span>
          {report.mcpServers.map((server, i) => (
            <div key={`${server.name}-${i}`} className="ext-row">
              <Plug size={10} strokeWidth={1.5} />
              <span className="ext-name ext-name--static">{server.name}</span>
              <span className="ext-description" title={server.target}>
                {server.target}
              </span>
              {server.ours && <span className="hook-ours">Multiterm</span>}
              {/* A project server that has not been approved is present in the
                  file and not loading, which looks identical from a session. */}
              {server.approved === undefined && server.source === 'project' && (
                <span className="ext-pending" title="Claude Code asks before loading it">
                  <HelpCircle size={9} strokeWidth={2} /> unapproved
                </span>
              )}
              {server.approved === false && <span className="ext-rejected">rejected</span>}
              <span className="config-scope">{server.source === 'user' ? 'User' : 'Project'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
