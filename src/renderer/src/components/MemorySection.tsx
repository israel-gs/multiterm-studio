import { useEffect, useState } from 'react'
import { AlertTriangle, EyeOff, FileText } from 'lucide-react'
import {
  MEMORY_KIND_LABELS,
  type MemoryFile,
  type MemoryReport
} from '../../../shared/claudeMemory'

interface Props {
  cwd: string
  reloadKey: number
  /** `claudeMdExcludes` in force, so excluded files can be marked. */
  excludes: string[]
  onOpenFile: (path: string) => void
}

function shorten(path: string, cwd: string): string {
  if (path.startsWith(cwd)) return path.slice(cwd.length + 1) || path
  return path.replace(/^\/Users\/[^/]+/, '~')
}

function Row({
  file,
  cwd,
  onOpenFile
}: {
  file: MemoryFile
  cwd: string
  onOpenFile: (path: string) => void
}): React.JSX.Element {
  return (
    <div className={`memory-row${file.excluded ? ' memory-row--excluded' : ''}`}>
      <div className="memory-row-main">
        <button className="memory-path" onClick={() => onOpenFile(file.path)} title={file.path}>
          {shorten(file.path, cwd)}
        </button>
        <span className="config-scope">{MEMORY_KIND_LABELS[file.kind]}</span>
        {file.exists ? (
          <span className="memory-size">{file.lines} lines</span>
        ) : (
          <span className="config-file-missing-tag">absent</span>
        )}
      </div>

      {file.conditionalOn && (
        // A path-scoped rule is not part of the startup cost: it arrives only
        // when Claude touches a file it matches.
        <p className="memory-note">Loads only for {file.conditionalOn.join(', ')}</p>
      )}

      {file.excluded && (
        <p className="memory-note">
          <EyeOff size={9} strokeWidth={1.5} /> Excluded by claudeMdExcludes — never read.
        </p>
      )}

      {file.imports.length > 0 && (
        <p className="memory-note">Imports {file.imports.map((i) => `@${i.raw}`).join(', ')}</p>
      )}

      {file.warning && (
        <p className="memory-warning">
          <AlertTriangle size={9} strokeWidth={1.5} /> {file.warning}
        </p>
      )}
    </div>
  )
}

/**
 * The instruction files Claude Code loads, in the order it loads them.
 *
 * They concatenate rather than override, so the useful questions are how much
 * of the context window they cost and whether any of it is being dropped —
 * both of which are invisible from inside a session.
 */
export function MemorySection({
  cwd,
  reloadKey,
  excludes,
  onOpenFile
}: Props): React.JSX.Element | null {
  const [report, setReport] = useState<MemoryReport | null>(null)

  useEffect(() => {
    let cancelled = false
    window.electronAPI
      .claudeConfigMemory(cwd, excludes)
      .then((result) => {
        if (!cancelled) setReport(result)
      })
      .catch(() => {
        if (!cancelled) setReport(null)
      })
    return () => {
      cancelled = true
    }
  }, [cwd, excludes, reloadKey])

  if (!report) return null

  return (
    <section className="config-group">
      <h3 className="config-group-title">Instructions and memory</h3>

      <p className="memory-summary">
        <FileText size={10} strokeWidth={1.5} /> {report.startupLines} lines load into every
        session, before you type anything.
      </p>

      {report.files.map((file) => (
        <Row key={file.path} file={file} cwd={cwd} onOpenFile={onOpenFile} />
      ))}
    </section>
  )
}
