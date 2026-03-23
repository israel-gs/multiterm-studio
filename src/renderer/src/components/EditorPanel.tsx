import { useRef, useEffect, useState } from 'react'
import * as monaco from 'monaco-editor'
import { colors, lightColors, fonts } from '../tokens'
import { usePanelStore } from '../store/panelStore'
import { useAppearanceStore } from '../store/appearanceStore'
import { MarkdownPreview } from './MarkdownPreview'

interface EditorPanelProps {
  sessionId: string
  filePath: string
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  swift: 'swift',
  kt: 'kotlin',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  sql: 'sql',
  graphql: 'graphql',
  dockerfile: 'dockerfile'
}

function detectLanguage(filePath: string): string {
  const name = filePath.split('/').pop() ?? ''
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'mdx'
}

// Define custom themes once
let themesRegistered = false
function ensureThemes(): void {
  if (themesRegistered) return
  themesRegistered = true
  monaco.editor.defineTheme('multiterm-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': colors.bgCard,
      'editor.foreground': colors.fgPrimary,
      'editor.selectionBackground': colors.selection,
      'editorCursor.foreground': colors.fgPrimary,
      'editorLineNumber.foreground': colors.fgSecondary,
      'editorWidget.background': '#2a2a2a',
      'editorWidget.border': '#3e3e3e'
    }
  })
  monaco.editor.defineTheme('multiterm-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': lightColors.bgCard,
      'editor.foreground': lightColors.fgPrimary,
      'editor.selectionBackground': lightColors.selection,
      'editorCursor.foreground': lightColors.fgPrimary,
      'editorLineNumber.foreground': lightColors.fgSecondary,
      'editorWidget.background': '#f0f0f0',
      'editorWidget.border': '#d0d0d0'
    }
  })
}

function resolveMonacoTheme(): string {
  const mode = useAppearanceStore.getState().mode
  if (mode === 'light') return 'multiterm-light'
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'multiterm-light' : 'multiterm-dark'
  }
  return 'multiterm-dark'
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
        window.electronAPI.fileRead(filePath).then(setPreviewContent).catch(() => {})
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
    let savedVersionId: number | null = null

    window.electronAPI.fileRead(filePath).then((content) => {
      if (disposed) return

      const language = detectLanguage(filePath)
      editor = monaco.editor.create(container, {
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
      contentDisposable?.dispose()
      ro?.disconnect()
      editor?.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <MarkdownPreview content={previewContent} basePath={filePath.substring(0, filePath.lastIndexOf('/'))} />
      )}
    </div>
  )
}
