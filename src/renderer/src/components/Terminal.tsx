import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { colors, fonts } from '../tokens'
import { usePanelStore } from '../store/panelStore'

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

export function TerminalPanel({ sessionId, cwd }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      scrollback: 10000,
      fontSize: 14,
      fontFamily: fonts.mono,
      theme: darkTheme,
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
    window.electronAPI.ptyCreate(sessionId, cwd)

    // Write initial command if configured (e.g. agent viewer script)
    const meta = usePanelStore.getState().panels[sessionId]
    if (meta?.initialCommand) {
      const cmd = meta.initialCommand
      setTimeout(() => {
        window.electronAPI.ptyWrite(sessionId, cmd + '\n')
      }, 500)
    }

    // Renderer → Main: keyboard input
    term.onData((data) => {
      window.electronAPI.ptyWrite(sessionId, data)
    })

    // Main → Renderer: PTY output — capture unsubscribe to avoid listener leak
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

    return () => {
      unsubscribe()
      observer.disconnect()
      // NOTE: ptyKill is intentionally NOT called here.
      // PTY lifecycle is managed by TerminalCanvas's handleClosePanel
      // to avoid double-kill when a panel is closed.
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
