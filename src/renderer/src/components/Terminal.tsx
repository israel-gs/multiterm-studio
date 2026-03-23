import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { colors, lightColors, fonts } from '../tokens'
import { usePanelStore } from '../store/panelStore'
import { useAppearanceStore } from '../store/appearanceStore'

interface Props {
  sessionId: string
  cwd: string
}

const darkTheme = {
  background: colors.bgCard,
  foreground: colors.fgPrimary,
  cursor: colors.fgPrimary,
  selectionBackground: colors.selection,
  black: '#1a1a1a',
  red: colors.red,
  green: colors.green,
  yellow: colors.yellow,
  blue: colors.blue,
  magenta: colors.purple,
  cyan: colors.cyan,
  white: colors.fgPrimary,
  brightBlack: colors.fgSecondary,
  brightRed: colors.red,
  brightGreen: colors.green,
  brightYellow: colors.yellow,
  brightBlue: colors.blue,
  brightMagenta: colors.purple,
  brightCyan: colors.cyan,
  brightWhite: '#ffffff'
}

const lightTheme = {
  background: lightColors.bgCard,
  foreground: lightColors.fgPrimary,
  cursor: lightColors.fgPrimary,
  selectionBackground: lightColors.selection,
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: lightColors.fgSecondary,
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#000000'
}

function resolveTheme(): typeof darkTheme {
  const mode = useAppearanceStore.getState().mode
  if (mode === 'light') return lightTheme
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? lightTheme : darkTheme
  }
  return darkTheme
}

export function TerminalPanel({ sessionId, cwd }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      scrollback: 200000,
      fontSize: 14,
      fontFamily: fonts.mono,
      theme: resolveTheme(),
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: false,
      convertEol: false
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)

    // CRITICAL: term.open() must precede fitAddon.fit()
    term.open(containerRef.current)
    fitAddon.fit()

    // Create PTY session in main process
    // If initialCommand is set, pass it to ptyCreate so tmux launches
    // the command directly (no send-keys, no input leak)
    const meta = usePanelStore.getState().panels[sessionId]
    window.electronAPI.ptyCreate(sessionId, cwd, meta?.initialCommand)

    // Renderer → Main: keyboard input
    // Filter out DA1/DA2/XTVERSION responses that xterm.js generates in reply
    // to tmux terminal queries. The IPC roundtrip delay causes these to arrive
    // after tmux exits its query state, so tmux forwards them to the shell as text.
    const DA_RESPONSE = /^\x1b\[\??[\d;]*c$|^\x1b\[>[\d;]*c$|^\x1bP>[|].*\x1b\\$/
    term.onData((data) => {
      if (DA_RESPONSE.test(data)) return
      window.electronAPI.ptyWrite(sessionId, data)
    })

    // Scrollback recovery: write recovered scrollback before live data
    let hasScrollback = false
    const unsubScrollback = window.electronAPI.onPtyScrollback(sessionId, (data) => {
      hasScrollback = true
      term.write(data)
    })

    // Main → Renderer: PTY output
    const unsubscribe = window.electronAPI.onPtyData(sessionId, (data) => {
      term.write(data)
    })

    // Resize roundtrip: ResizeObserver → fitAddon.fit() → IPC pty:resize
    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      const { cols, rows } = term
      window.electronAPI.ptyResize(sessionId, cols, rows)
    })
    observer.observe(containerRef.current)

    // Live theme switching: update xterm.js theme when appearance changes
    const unsubAppearance = useAppearanceStore.subscribe(() => {
      term.options.theme = resolveTheme()
    })

    // Track PWD changes via OSC 7
    term.parser.registerOscHandler(7, (data) => {
      // OSC 7 format: file://hostname/path
      try {
        const url = new URL(data)
        const pwd = decodeURIComponent(url.pathname)
        if (pwd) {
          usePanelStore.getState().setCwd(sessionId, pwd)
        }
      } catch {
        // Not a valid URL, try as plain path
        if (data.startsWith('/')) {
          usePanelStore.getState().setCwd(sessionId, data)
        }
      }
      return false // don't consume, let xterm handle it too
    })

    // Poll for running process indicator
    const processInterval = setInterval(async () => {
      const has = await window.electronAPI.ptyHasProcess(sessionId)
      usePanelStore.getState().setHasProcess(sessionId, has)
    }, 3000)

    return () => {
      unsubAppearance()
      unsubScrollback()
      unsubscribe()
      observer.disconnect()
      clearInterval(processInterval)
      // NOTE: ptyKill is intentionally NOT called here.
      // PTY lifecycle is managed by TerminalCanvas's handleClosePanel
      // to avoid double-kill when a panel is closed.
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
