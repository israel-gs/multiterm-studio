import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  cwd: string
}

const darkTheme = {
  background: '#1c1c1c',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#1a1a1a',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#d7ba7d',
  blue: '#569cd6',
  magenta: '#c678dd',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#d7ba7d',
  brightBlue: '#569cd6',
  brightMagenta: '#c678dd',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff'
}

export function TerminalPanel({ sessionId, cwd }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      scrollback: 10000,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
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
      // PTY lifecycle is managed by TerminalGrid's handleClosePanel
      // to avoid double-kill when a panel is closed.
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
