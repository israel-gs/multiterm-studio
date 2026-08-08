import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { fonts } from '../tokens'
import { usePanelStore } from '../store/panelStore'
import { useProjectStore } from '../store/projectStore'
import { useAppearanceStore } from '../store/appearanceStore'
import { detectLanguage, ensureThemes, resolveMonacoTheme } from '../utils/monacoSetup'
import type { GitFileDiff } from '../../../shared/git'

interface DiffPanelProps {
  sessionId: string
  /** Repository root — the folder every git call runs in. */
  cwd: string
  /** Absolute path of the file being compared. */
  filePath: string
}

/** How long the file watcher must settle before the diff is re-read. */
const RELOAD_DEBOUNCE_MS = 300

export function DiffPanel({ sessionId, cwd, filePath }: DiffPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const staged = usePanelStore((s) => s.panels[sessionId]?.diffStaged ?? false)
  const setDiffStaged = usePanelStore((s) => s.setDiffStaged)
  const fsRefreshKey = useProjectStore((s) => s.fsRefreshKey)
  const [diff, setDiff] = useState<GitFileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create the editor once and keep it: swapping models on reload preserves
  // the scroll position, which is the whole point of a diff you watch while
  // an agent edits the file underneath you.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    ensureThemes()
    const editor = monaco.editor.createDiffEditor(container, {
      theme: resolveMonacoTheme(),
      fontFamily: fonts.mono,
      fontSize: 13,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      // Monaco owns the measuring. Maximizing a tile re-parents the card into a
      // portal on document.body, and an observer of our own does not see that
      // move — the editor kept the size of the small tile and the rest of the
      // card stayed blank.
      automaticLayout: true,
      ignoreTrimWhitespace: false
    })
    editorRef.current = editor

    const unsubAppearance = useAppearanceStore.subscribe(() => {
      monaco.editor.setTheme(resolveMonacoTheme())
    })

    return () => {
      unsubAppearance()
      const models = editor.getModel()
      editor.dispose()
      // createDiffEditor does not own the models it is given.
      models?.original.dispose()
      models?.modified.dispose()
      editorRef.current = null
    }
  }, [])

  // Read the diff: immediately when the file or the side changes, debounced
  // when the watcher fires so a rebuild does not cost one `git show` per file
  // it touches.
  useEffect(() => {
    let cancelled = false
    const delay = fsRefreshKey === 0 ? 0 : RELOAD_DEBOUNCE_MS

    const timer = setTimeout(() => {
      window.electronAPI
        .gitDiff(cwd, filePath, staged)
        .then((result) => {
          if (cancelled) return
          if (result.ok) {
            setDiff(result.diff)
            setError(null)
          } else {
            setDiff(null)
            setError(result.error)
          }
        })
        .catch(() => {
          if (!cancelled) setError('Failed to read diff')
        })
    }, delay)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [cwd, filePath, staged, fsRefreshKey])

  // Push the loaded diff into the editor as a fresh pair of models.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !diff || diff.kind !== 'text') return

    const language = detectLanguage(filePath)
    const previous = editor.getModel()
    editor.setModel({
      original: monaco.editor.createModel(diff.original, language),
      modified: monaco.editor.createModel(diff.modified, language)
    })
    previous?.original.dispose()
    previous?.modified.dispose()
    editor.layout()
  }, [diff, filePath])

  const unreadable =
    diff?.kind === 'binary'
      ? 'Binary file — nothing to show side by side'
      : diff?.kind === 'too-large'
        ? 'File is too large to diff'
        : null

  return (
    <div className="diff-panel">
      <div className="diff-panel-toolbar">
        <div className="diff-panel-tabs" role="group" aria-label="Diff side">
          <button
            className={`diff-panel-tab${staged ? '' : ' diff-panel-tab--active'}`}
            onClick={() => setDiffStaged(sessionId, false)}
            aria-pressed={!staged}
          >
            Working tree
          </button>
          <button
            className={`diff-panel-tab${staged ? ' diff-panel-tab--active' : ''}`}
            onClick={() => setDiffStaged(sessionId, true)}
            aria-pressed={staged}
          >
            Staged
          </button>
        </div>
        <span className="diff-panel-against">
          {staged ? 'index vs HEAD' : 'working tree vs index'}
        </span>
      </div>

      {error && <p className="diff-panel-message diff-panel-message--error">{error}</p>}
      {!error && unreadable && <p className="diff-panel-message">{unreadable}</p>}

      <div
        ref={containerRef}
        className="diff-panel-editor"
        style={{ display: error || unreadable ? 'none' : 'block' }}
      />
    </div>
  )
}
