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
  zoomRef?: React.RefObject<number>
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

export function TerminalPanel({ sessionId, cwd, zoomRef }: Props): React.JSX.Element {
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
      convertEol: false,
      allowProposedApi: true
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

    // Clipboard integration: Cmd+C copies selection to system clipboard,
    // Cmd+V pastes from system clipboard into the terminal.
    // Returns false to let xterm handle the event normally, true to prevent it.
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== 'keydown') return true
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'c') {
        const sel = term.getSelection()
        if (sel) {
          window.electronAPI.clipboardWriteText(sel)
          return false // let xterm also handle (clears selection etc.)
        }
      }
      if (mod && e.key === 'v') {
        // Let the browser's native paste event handle this.
        // xterm.js intercepts the paste event and feeds it through onData → ptyWrite.
        return true
      }
      return true
    })

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

    // Handle OSC 52 clipboard sequences from tmux.
    // When tmux copies text (mouse selection with set-clipboard on), it sends
    // OSC 52: \x1b]52;c;<base64>\x07 (or \x1b\\ as terminator).
    // We intercept this, decode the base64, and write to system clipboard.
    const OSC52_RE = /\x1b\]52;[a-z]*;([A-Za-z0-9+/=]*)\x07|\x1b\]52;[a-z]*;([A-Za-z0-9+/=]*)\x1b\\/g
    function handleOsc52(data: string): string {
      return data.replace(OSC52_RE, (_match, b64a, b64b) => {
        const b64 = b64a || b64b
        if (b64) {
          try {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
            const text = new TextDecoder().decode(bytes)
            window.electronAPI.clipboardWriteText(text)
          } catch { /* ignore decode errors */ }
        }
        return '' // strip the OSC 52 sequence from terminal output
      })
    }

    // Main → Renderer: PTY output
    const unsubscribe = window.electronAPI.onPtyData(sessionId, (data) => {
      term.write(handleOsc52(data))
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

    // Fix mouse selection under CSS scale transform:
    // The tile layer uses transform: scale(S), which causes xterm.js to compute
    // wrong cell positions from mouse events (screen-space offset / logical cell size).
    // We intercept mouse events in capture phase and adjust clientX/clientY so the
    // offset from getBoundingClientRect() is in logical pixels.
    const xtermScreen = containerRef.current.querySelector('.xterm-screen')
    function adjustMouseForZoom(e: MouseEvent): void {
      const scale = zoomRef?.current ?? 1
      if (scale === 1 || !xtermScreen) return
      const rect = xtermScreen.getBoundingClientRect()
      Object.defineProperty(e, 'clientX', {
        value: rect.left + (e.clientX - rect.left) / scale
      })
      Object.defineProperty(e, 'clientY', {
        value: rect.top + (e.clientY - rect.top) / scale
      })
    }
    if (xtermScreen) {
      xtermScreen.addEventListener('mousedown', adjustMouseForZoom, true)
      xtermScreen.addEventListener('mousemove', adjustMouseForZoom, true)
      xtermScreen.addEventListener('mouseup', adjustMouseForZoom, true)
    }

    // Poll for CWD and running process indicator via tmux
    const processInterval = setInterval(async () => {
      const [has, cwd] = await Promise.all([
        window.electronAPI.ptyHasProcess(sessionId),
        window.electronAPI.ptyGetCwd(sessionId)
      ])
      const store = usePanelStore.getState()
      store.setHasProcess(sessionId, has)
      if (cwd) store.setCwd(sessionId, cwd)
    }, 3000)

    return () => {
      unsubAppearance()
      unsubScrollback()
      unsubscribe()
      observer.disconnect()
      clearInterval(processInterval)
      if (xtermScreen) {
        xtermScreen.removeEventListener('mousedown', adjustMouseForZoom, true)
        xtermScreen.removeEventListener('mousemove', adjustMouseForZoom, true)
        xtermScreen.removeEventListener('mouseup', adjustMouseForZoom, true)
      }
      // NOTE: ptyKill is intentionally NOT called here.
      // PTY lifecycle is managed by TerminalCanvas's handleClosePanel
      // to avoid double-kill when a panel is closed.
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
