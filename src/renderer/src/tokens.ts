/**
 * Design tokens — single source of truth for values shared between CSS and JS.
 * CSS custom properties with matching values are defined in global.css.
 * Use these constants when JS needs raw values (e.g. xterm theme, color parsing).
 */

export const fonts = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", "Fira Code", Menlo, monospace'
} as const

export const colors = {
  blue: '#569cd6',
  green: '#6a9955',
  red: '#f44747',
  yellow: '#d7ba7d',
  purple: '#c678dd',
  cyan: '#4ec9b0',
  bgCard: '#1c1c1c',
  fgPrimary: '#d4d4d4',
  fgSecondary: '#808080',
  selection: '#264f78'
} as const

/** Panel preset colors for the color picker */
export const PANEL_COLORS = [
  colors.blue,
  colors.green,
  colors.red,
  colors.yellow,
  colors.purple,
  colors.cyan
] as const
