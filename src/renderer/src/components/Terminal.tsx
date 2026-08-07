import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { colors, lightColors, fonts } from '../tokens'
import { usePanelStore } from '../store/panelStore'
import { useAppearanceStore } from '../store/appearanceStore'

interface Props {
  sessionId: string
  cwd: string
  zoomRef?: React.RefObject<number>
}

const darkTheme: ITheme = {
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

const lightTheme: ITheme = {
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

function resolveTheme(): ITheme {
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
      // xterm preallocates a slot per scrollback line in both the normal and
      // alternate buffers, so this is a per-tile memory floor paid by every
      // terminal on the canvas — 200_000 costs megabytes per tile before a
      // single byte of output. The sidecar keeps the authoritative history
      // (see the scrollback setting), this is just what stays scrollable in
      // the UI.
      scrollback: 50_000,
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

    // GPU renderer. The DOM renderer repaints every cell as an element, which
    // is what makes a canvas full of busy terminals crawl. Must be loaded after
    // open(); if the context is lost or unavailable, xterm falls back to the
    // DOM renderer on its own once the addon is disposed.
    let webglAddon: WebglAddon | null = null
    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      term.loadAddon(webglAddon)
    } catch {
      // No WebGL available (software rendering, remote session) — DOM renderer.
      webglAddon = null
    }

    fitAddon.fit()

    // Register OSC 7 handler for CWD tracking.
    // Shells emit: \x1b]7;file://hostname/path\x07 on every directory change.
    term.parser.registerOscHandler(7, (data: string) => {
      try {
        const url = new URL(data)
        const cwd = decodeURIComponent(url.pathname)
        window.electronAPI.ptyCwdChanged(sessionId, cwd)
        // Also update the store directly for immediate UI responsiveness
        usePanelStore.getState().setCwd(sessionId, cwd)
      } catch {
        // Malformed sequence — ignore
      }
      return true
    })

    // Create PTY session in main process
    // If initialCommand is set, pass it to ptyCreate so the sidecar sends it after spawn
    const meta = usePanelStore.getState().panels[sessionId]
    window.electronAPI.ptyCreate(sessionId, cwd, meta?.initialCommand).catch((err: Error) => {
      // Surface the failure in the tile instead of leaving a blank terminal.
      term.write(`\r\n\x1b[31mFailed to start terminal: ${err.message}\x1b[0m\r\n`)
    })

    // Shell died (or the sidecar went away) — say so instead of pretending the
    // dead terminal is still live.
    const unsubExit = window.electronAPI.onPtyExit(sessionId, (info) => {
      const reason = info.disconnected
        ? 'terminal backend disconnected'
        : info.signal
          ? `killed by signal ${info.signal}`
          : `exited with code ${info.exitCode}`
      term.write(`\r\n\x1b[2m[process ${reason}]\x1b[0m\r\n`)
      usePanelStore.getState().setHasProcess(sessionId, false, null)
    })

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
    // to terminal queries. The IPC roundtrip delay causes these to arrive
    // after the shell exits its query state, so they get forwarded to the shell as text.
    // eslint-disable-next-line no-control-regex -- matching ANSI escapes is the point
    const DA_RESPONSE = /^\x1b\[\??[\d;]*c$|^\x1b\[>[\d;]*c$|^\x1bP>[|].*\x1b\\$/
    term.onData((data) => {
      if (DA_RESPONSE.test(data)) return
      window.electronAPI.ptyWrite(sessionId, data)
    })

    // Scrollback recovery: write recovered scrollback before live data
    const unsubScrollback = window.electronAPI.onPtyScrollback(sessionId, (data) => {
      term.write(data)
    })

    // Handle OSC 52 clipboard sequences.
    // When a terminal copies text (mouse selection with set-clipboard on), it sends
    // OSC 52: \x1b]52;c;<base64>\x07 (or \x1b\\ as terminator).
    //
    // Registering with xterm's parser rather than regex-replacing each chunk:
    // the parser reassembles sequences split across reads, which a per-chunk
    // regex silently misses (and it strips the sequence from the output for us).
    // Off means the sequence is still consumed (so it never prints as garbage)
    // but the clipboard is left alone.
    let osc52Allowed = true
    void window.electronAPI
      .settingsGet('terminal.osc52Clipboard')
      .then((raw) => {
        if (typeof raw === 'boolean') osc52Allowed = raw
      })
      .catch(() => {
        /* keep the default */
      })

    term.parser.registerOscHandler(52, (data: string) => {
      const b64 = data.slice(data.indexOf(';') + 1)
      if (osc52Allowed && b64 && b64 !== '?') {
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          window.electronAPI.clipboardWriteText(new TextDecoder().decode(bytes))
        } catch {
          /* ignore decode errors */
        }
      }
      return true
    })

    // Main → Renderer: PTY output
    const unsubscribe = window.electronAPI.onPtyData(sessionId, (data) => {
      term.write(data)
    })

    // Resize roundtrip: ResizeObserver → fitAddon.fit() → IPC pty:resize
    //
    // Coalesced into one frame: dragging a tile edge fires the observer on
    // every pointer move, and each raw call reflows xterm and sends the PTY a
    // SIGWINCH. Programs like vim repaint on every one of those.
    let resizeRaf: number | null = null
    let lastCols = 0
    let lastRows = 0
    const observer = new ResizeObserver(() => {
      if (resizeRaf !== null) return
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null
        fitAddon.fit()
        const { cols, rows } = term
        // fit() often lands on the same cell grid — only tell the PTY when the
        // dimensions actually changed.
        if (cols === lastCols && rows === lastRows) return
        lastCols = cols
        lastRows = rows
        window.electronAPI.ptyResize(sessionId, cols, rows)
      })
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
    const xtermScreen = containerRef.current.querySelector<HTMLElement>('.xterm-screen')
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

    // Poll for CWD and running process indicator
    const processInterval = setInterval(async () => {
      const [result, cwd] = await Promise.all([
        window.electronAPI.ptyHasProcess(sessionId),
        window.electronAPI.ptyGetCwd(sessionId)
      ])
      const store = usePanelStore.getState()
      // Support both old boolean and new {hasProcess, processName} return
      const has = typeof result === 'object' && result !== null ? result.hasProcess : !!result
      const processName = typeof result === 'object' && result !== null ? result.processName : null
      store.setHasProcess(sessionId, has, processName)
      if (cwd) store.setCwd(sessionId, cwd)
    }, 3000)

    return () => {
      unsubAppearance()
      unsubScrollback()
      unsubExit()
      unsubscribe()
      observer.disconnect()
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf)
      clearInterval(processInterval)
      if (xtermScreen) {
        xtermScreen.removeEventListener('mousedown', adjustMouseForZoom, true)
        xtermScreen.removeEventListener('mousemove', adjustMouseForZoom, true)
        xtermScreen.removeEventListener('mouseup', adjustMouseForZoom, true)
      }
      webglAddon?.dispose()
      // NOTE: ptyKill is intentionally NOT called here.
      // PTY lifecycle is managed by TerminalCanvas's handleClosePanel
      // to avoid double-kill when a panel is closed.
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
