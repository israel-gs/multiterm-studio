import * as monaco from 'monaco-editor'
import { colors, lightColors } from '../tokens'
import { useAppearanceStore } from '../store/appearanceStore'
import { basename } from './path'

/**
 * Monaco setup shared by the editor and diff tiles.
 *
 * This module pulls in monaco-editor (~13 MB with its language workers), so it
 * must only ever be imported from a lazily loaded panel — importing it from
 * anywhere eager puts monaco back in the startup bundle for canvases made
 * entirely of terminals.
 */

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

/**
 * Options every editor tile needs, whatever kind it is.
 *
 * Monaco lifts hovers, suggestions and messages out of the editor and places
 * them in page coordinates taken from its own layout. Tiles live inside the
 * canvas's CSS transform, which that maths does not know about, so the widgets
 * landed in a corner of the window. `fixedOverflowWidgets` switches them to
 * fixed positioning measured with getBoundingClientRect, which does account for
 * the transform.
 */
export const SHARED_EDITOR_OPTIONS = {
  fixedOverflowWidgets: true
} as const

export function detectLanguage(filePath: string): string {
  const name = basename(filePath)
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  if (lower === 'makefile') return 'makefile'
  const ext = name.includes('.') ? (name.split('.').pop()?.toLowerCase() ?? '') : ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

// Define custom themes once
let themesRegistered = false

export function ensureThemes(): void {
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

export function resolveMonacoTheme(): string {
  const mode = useAppearanceStore.getState().mode
  if (mode === 'light') return 'multiterm-light'
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'multiterm-light'
      : 'multiterm-dark'
  }
  return 'multiterm-dark'
}
