import { useRef, useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { fonts } from '../tokens'
import { usePanelStore } from '../store/panelStore'
import { useAppearanceStore } from '../store/appearanceStore'
import { MarkdownPreview } from './MarkdownPreview'
import {
  SHARED_EDITOR_OPTIONS,
  detectLanguage,
  ensureThemes,
  resolveMonacoTheme
} from '../utils/monacoSetup'
import { forgetScroll, recallScroll, rememberScroll } from '../utils/scrollMemory'

interface EditorPanelProps {
  sessionId: string
  filePath: string
}

function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'mdx'
}

export function EditorPanel({ sessionId, filePath }: EditorPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const previewMode = usePanelStore((s) => s.panels[sessionId]?.previewMode ?? false)
  const [previewContent, setPreviewContent] = useState('')
  const isMarkdown = isMarkdownFile(filePath)

  // When entering preview mode, snapshot editor content.
  // Falls back to reading from file if editor isn't available (e.g. after portal remount on maximize)
  useEffect(() => {
    if (previewMode) {
      if (editorRef.current) {
        setPreviewContent(editorRef.current.getValue())
      } else {
        window.electronAPI
          .fileRead(filePath)
          .then(setPreviewContent)
          .catch(() => {})
      }
    }
  }, [previewMode, filePath])

  // Re-layout monaco when returning from preview
  useEffect(() => {
    if (!previewMode && editorRef.current) {
      // Small delay to let the container become visible before layout
      requestAnimationFrame(() => editorRef.current?.layout())
    }
  }, [previewMode])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    ensureThemes()

    let disposed = false
    let editor: monaco.editor.IStandaloneCodeEditor | null = null
    let ro: ResizeObserver | null = null
    let contentDisposable: monaco.IDisposable | null = null
    let scrollDisposable: monaco.IDisposable | null = null
    let savedVersionId: number | null = null

    window.electronAPI.fileRead(filePath).then((content) => {
      if (disposed) return

      const language = detectLanguage(filePath)
      editor = monaco.editor.create(container, {
        ...SHARED_EDITOR_OPTIONS,
        value: content,
        language,
        theme: resolveMonacoTheme(),
        fontFamily: fonts.mono,
        fontSize: 14,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: false,
        padding: { top: 8 }
      })
      editorRef.current = editor

      savedVersionId = editor.getModel()!.getAlternativeVersionId()

      // Maximizing re-parents the card into a portal, which remounts this panel
      // and builds a new editor. The position is kept outside React so the new
      // one can resume where the old one was.
      const top = recallScroll(sessionId)
      if (top) editor.setScrollTop(top)
      scrollDisposable = editor.onDidScrollChange((e) => rememberScroll(sessionId, e.scrollTop))

      contentDisposable = editor.getModel()!.onDidChangeContent(() => {
        const currentVersionId = editor!.getModel()!.getAlternativeVersionId()
        const isDirty = currentVersionId !== savedVersionId
        const store = usePanelStore.getState()
        const panel = store.panels[sessionId]
        if (panel && panel.dirty !== isDirty) {
          if (isDirty) store.setDirty(sessionId)
          else store.clearDirty(sessionId)
        }
      })

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        const value = editor!.getValue()
        window.electronAPI.fileWrite(filePath, value).then(() => {
          savedVersionId = editor!.getModel()!.getAlternativeVersionId()
          usePanelStore.getState().clearDirty(sessionId)
        })
      })

      ro = new ResizeObserver(() => {
        editor?.layout()
      })
      ro.observe(container)
    })

    // Live theme switching
    const unsubAppearance = useAppearanceStore.subscribe(() => {
      monaco.editor.setTheme(resolveMonacoTheme())
    })

    return () => {
      unsubAppearance()
      disposed = true
      // The panel is gone from the store only when the tile was closed; a
      // remount must keep its position.
      if (!usePanelStore.getState().panels[sessionId]) forgetScroll(sessionId)
      contentDisposable?.dispose()
      scrollDisposable?.dispose()
      ro?.disconnect()
      editor?.dispose()
      editorRef.current = null
    }
  }, [sessionId, filePath])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Monaco editor — hidden when preview is active */}
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          display: isMarkdown && previewMode ? 'none' : 'block'
        }}
      />
      {/* Markdown preview overlay */}
      {isMarkdown && previewMode && (
        <MarkdownPreview
          content={previewContent}
          basePath={filePath.substring(0, filePath.lastIndexOf('/'))}
        />
      )}
    </div>
  )
}
