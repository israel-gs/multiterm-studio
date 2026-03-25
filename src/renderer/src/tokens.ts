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

export const lightColors = {
  bgCard: '#ffffff',
  fgPrimary: '#1e1e1e',
  fgSecondary: '#6e6e6e',
  selection: '#add6ff'
} as const

/** Panel preset colors for the color picker */
export const PANEL_COLORS: readonly { hex: string; label: string }[] = [
  { hex: colors.bgCard, label: 'Default' },
  { hex: '#569cd6', label: 'Blue' },
  { hex: '#4ec9b0', label: 'Teal' },
  { hex: '#6a9955', label: 'Green' },
  { hex: '#b5cea8', label: 'Mint' },
  { hex: '#d7ba7d', label: 'Gold' },
  { hex: '#ce9178', label: 'Peach' },
  { hex: '#f44747', label: 'Red' },
  { hex: '#c678dd', label: 'Purple' },
  { hex: '#d16d9e', label: 'Pink' },
  { hex: '#808080', label: 'Gray' },
  { hex: '#dcdcaa', label: 'Cream' }
] as const

export type AppearanceMode = 'dark' | 'light' | 'system'
