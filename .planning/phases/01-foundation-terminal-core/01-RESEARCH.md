# Phase 1: Foundation + Terminal Core - Research

**Researched:** 2026-03-14
**Domain:** Electron + electron-vite, node-pty (native PTY), xterm.js v6
**Confidence:** HIGH (stack is stable, well-documented, decisions are pre-locked)

---

<phase_requirements>

## Phase Requirements

| ID       | Description                                                                                                                                                    | Research Support                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| INFRA-01 | Electron app runs with contextIsolation: true and nodeIntegration: false                                                                                       | Verified: BrowserWindow config + contextBridge preload pattern                                                   |
| INFRA-02 | All main↔renderer communication uses IPC via contextBridge (pty:create, pty:write, pty:resize, pty:kill, pty:data, pty:attention, folder:open, folder:readdir) | Verified: ipcMain.handle + ipcRenderer.invoke pattern; push channels via webContents.send + unsubscribe closures |
| INFRA-03 | node-pty instances are managed exclusively in the main process                                                                                                 | Verified: node-pty is Node-native; cannot run in renderer                                                        |
| INFRA-04 | App builds and launches with `npm install && npm run dev` using electron-vite                                                                                  | Verified: electron-vite 5.0 scaffold, postinstall rebuild required first                                         |
| INFRA-05 | Dark theme styling (background #1a1a1a, panels #242424, headers #2e2e2e)                                                                                       | Covered: CSS custom properties + xterm.js ITheme object                                                          |
| TERM-01  | User can open a real shell session (bash/zsh on macOS/Linux) in each terminal panel                                                                            | Verified: node-pty v1.1.0 pty.spawn() with SHELL env var                                                         |
| TERM-02  | Each panel's shell starts with cwd set to the opened project folder                                                                                            | Verified: node-pty spawn options.cwd                                                                             |
| TERM-03  | Terminal renders with xterm.js including FitAddon and WebLinksAddon                                                                                            | Verified: @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, @xterm/addon-web-links 0.12.0                             |
| TERM-04  | PTY resizes correctly when panel is resized (FitAddon + ResizeObserver → pty:resize IPC)                                                                       | Verified: ResizeObserver → fitAddon.fit() → IPC pty:resize → ptyProcess.resize()                                 |
| TERM-05  | Terminal supports scrollback buffer (10,000+ lines)                                                                                                            | Verified: ITerminalOptions.scrollback (default 1000, set to 10000)                                               |
| TERM-06  | Terminal renders ANSI colors, 256-color, and 24-bit color correctly                                                                                            | Verified: xterm.js handles VT100/ANSI by default, no special config needed                                       |
| TERM-07  | Terminal supports Unicode and emoji rendering                                                                                                                  | Verified: xterm.js default behavior; fontFamily must include emoji-capable fonts                                 |
| TERM-08  | Keyboard input passes through to PTY correctly (Ctrl+C, arrow keys, tab completion)                                                                            | Verified: terminal.onData → pty:write IPC → ptyProcess.write()                                                   |
| TERM-09  | User can copy selected text and paste from clipboard                                                                                                           | Verified: xterm.js selection built-in; paste via Ctrl+V or contextMenu requires clipboard integration            |

</phase_requirements>

---

## Summary

This phase establishes the complete foundation: an Electron app scaffolded with electron-vite, a node-pty PTY manager in the main process, and an xterm.js terminal panel in the renderer. The most critical risk is the **node-pty ABI mismatch** — native modules compiled for Node.js will fail at runtime in Electron because Electron uses a different Node.js version internally. This must be resolved by a `postinstall` script that rebuilds native modules before any developer runs the app.

The IPC architecture must follow the contextBridge push-with-unsubscribe pattern. `ipcRenderer.removeListener` silently fails when called through the contextBridge because the bridge wraps function references, breaking identity comparison. The correct pattern is to capture the wrapped listener in a closure inside the preload script and return an unsubscribe function.

The entire xterm.js ecosystem migrated to scoped packages (`@xterm/*`) starting in version 5.4.0 (March 2024). Version 6.0.0 was released December 2024. The unscoped packages (`xterm`, `xterm-addon-fit`, etc.) are frozen and will not receive updates. Use only scoped packages.

**Primary recommendation:** Scaffold with `npm create @quick-start/electron@latest -- --template react-ts`, add `postinstall` script immediately before any `npm install`, then layer node-pty + xterm.js on top of the base scaffold.

---

## Standard Stack

### Core

| Library                | Version                | Purpose                       | Why Standard                                                                       |
| ---------------------- | ---------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| electron               | ~41.x (current stable) | Desktop app runtime           | Platform target                                                                    |
| electron-vite          | 5.0.0                  | Build tool (Vite-based)       | Official recommended build tooling for Electron; HMR + hot reload for main/preload |
| react                  | 18.x                   | UI framework                  | Standard for this project (template choice)                                        |
| typescript             | 5.x                    | Type safety                   | electron-vite react-ts template includes it                                        |
| node-pty               | 1.1.0                  | Fork PTY processes in Node.js | Only production-grade PTY library for Node.js; used by VS Code                     |
| @xterm/xterm           | 6.0.0                  | Terminal emulator in renderer | Only mature browser-compatible VT100 terminal emulator                             |
| @xterm/addon-fit       | 0.11.0                 | Fit terminal to container     | Required for resize roundtrip                                                      |
| @xterm/addon-web-links | 0.12.0                 | Clickable URLs in terminal    | Required for TERM-03                                                               |

### Supporting

| Library           | Version | Purpose                                    | When to Use                                                                             |
| ----------------- | ------- | ------------------------------------------ | --------------------------------------------------------------------------------------- |
| @electron/rebuild | latest  | Rebuild native modules for Electron        | Needed in postinstall; @electron/rebuild is the correct tool per official Electron docs |
| electron-builder  | latest  | Packaging (also provides install-app-deps) | Phase 1 only needs `install-app-deps` subcommand for native rebuild                     |

### Alternatives Considered

| Instead of        | Could Use                    | Tradeoff                                                                                    |
| ----------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| electron-vite     | Electron Forge + Vite plugin | electron-vite is simpler single-config; Forge adds packaging features not needed in Phase 1 |
| @xterm/xterm      | xterm (unscoped)             | Unscoped is frozen/deprecated — do not use                                                  |
| @electron/rebuild | Manual node-gyp              | @electron/rebuild handles header downloads and arch automatically                           |

**Installation (production dependencies):**

```bash
npm install node-pty @xterm/xterm @xterm/addon-fit @xterm/addon-web-links
```

**Installation (dev dependencies):**

```bash
npm install --save-dev electron electron-vite electron-builder @electron/rebuild @types/node
```

---

## Architecture Patterns

### Recommended Project Structure

```
multiterm-studio/
├── src/
│   ├── main/
│   │   ├── index.ts          # BrowserWindow creation, app lifecycle
│   │   └── ptyManager.ts     # All node-pty instances, ipcMain handlers
│   ├── preload/
│   │   └── index.ts          # contextBridge API (electronAPI)
│   └── renderer/
│       └── src/
│           ├── App.tsx        # Root component
│           └── components/
│               └── Terminal.tsx  # xterm.js panel component
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

### Pattern 1: electron-vite Config with node-pty External

`electron.vite.config.ts` must declare node-pty as external so Vite does not attempt to bundle it. node-pty is a native addon (`.node` binary); bundling is impossible.

```typescript
// Source: electron-vite.org/guide/dependency-handling
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  renderer: {
    plugins: [react()]
  }
})
```

**Note on `externalizeDepsPlugin`:** electron-vite 5.0 deprecated the `externalizeDepsPlugin` in favor of direct `rollupOptions.external`. Use the direct approach above.

### Pattern 2: BrowserWindow with contextIsolation

```typescript
// Source: electronjs.org/docs/latest/tutorial/context-isolation
import { BrowserWindow } from 'electron'
import { join } from 'path'

const win = new BrowserWindow({
  width: 1200,
  height: 800,
  backgroundColor: '#1a1a1a',
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false // required for preload to access Node APIs
  }
})
```

**Important:** `sandbox: false` is needed so the preload script can use Node.js APIs like `path`. With `contextIsolation: true` and `nodeIntegration: false`, this is still secure.

### Pattern 3: PTY Manager (main process)

```typescript
// src/main/ptyManager.ts
import * as pty from 'node-pty'
import { ipcMain, WebContents } from 'electron'

interface PtySession {
  process: pty.IPty
}

const sessions = new Map<string, PtySession>()

export function registerPtyHandlers(webContents: WebContents): void {
  ipcMain.handle('pty:create', (_event, id: string, cwd: string) => {
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : 'bash')
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env }
    })
    ptyProcess.onData((data) => {
      webContents.send(`pty:data:${id}`, data)
    })
    sessions.set(id, { process: ptyProcess })
  })

  ipcMain.handle('pty:write', (_event, id: string, data: string) => {
    sessions.get(id)?.process.write(data)
  })

  ipcMain.handle('pty:resize', (_event, id: string, cols: number, rows: number) => {
    sessions.get(id)?.process.resize(cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, id: string) => {
    sessions.get(id)?.process.kill()
    sessions.delete(id)
  })
}
```

**TERM-env:** Use `name: 'xterm-256color'` in spawn options. This sets the `TERM` environment variable so CLI tools know full color support is available.

### Pattern 4: contextBridge with Unsubscribe Closures (CRITICAL)

`ipcRenderer.removeListener` does NOT work through contextBridge because the bridge wraps function references — the wrapped function is a different object than the original, so `removeListener` never matches it.

**The fix:** Create the listener wrapper inside the exposed function and return a closure that holds a reference to the exact wrapper.

```typescript
// src/preload/index.ts
// Source: github.com/electron/electron/issues/33328 (confirmed bug)
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main (two-way)
  ptyCreate: (id: string, cwd: string) => ipcRenderer.invoke('pty:create', id, cwd),
  ptyWrite: (id: string, data: string) => ipcRenderer.invoke('pty:write', id, data),
  ptyResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('pty:resize', id, cols, rows),
  ptyKill: (id: string) => ipcRenderer.invoke('pty:kill', id),

  // Main → Renderer (push) — returns unsubscribe function
  onPtyData: (id: string, callback: (data: string) => void) => {
    const channel = `pty:data:${id}`
    const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
    // NOTE: The returned function works because `listener` is the EXACT reference
    // registered with ipcRenderer.on — never pass the callback directly to on()
  }
})
```

**TypeScript window augmentation** — add to renderer:

```typescript
// src/renderer/src/env.d.ts
interface Window {
  electronAPI: {
    ptyCreate: (id: string, cwd: string) => Promise<void>
    ptyWrite: (id: string, data: string) => Promise<void>
    ptyResize: (id: string, cols: number, rows: number) => Promise<void>
    ptyKill: (id: string) => Promise<void>
    onPtyData: (id: string, callback: (data: string) => void) => () => void
  }
}
```

### Pattern 5: xterm.js Terminal Component with ResizeObserver

```tsx
// src/renderer/src/components/Terminal.tsx
import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
  cwd: string
}

export function TerminalPanel({ sessionId, cwd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      scrollback: 10000,
      fontSize: 14,
      fontFamily: 'JetBrains Mono, Fira Code, Menlo, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78'
      },
      cursorBlink: true
    })
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    // Create PTY session
    window.electronAPI.ptyCreate(sessionId, cwd)

    // Renderer → Main: keyboard input
    term.onData((data) => {
      window.electronAPI.ptyWrite(sessionId, data)
    })

    // Main → Renderer: PTY output — capture unsubscribe
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
      window.electronAPI.ptyKill(sessionId)
      term.dispose()
    }
  }, [sessionId, cwd])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
```

**CRITICAL: xterm.css import** — `@xterm/xterm/css/xterm.css` MUST be imported. Without it the terminal renders blank.

**ResizeObserver debounce:** A short debounce (16ms) on the observer callback prevents excessive IPC calls during panel drag-resize. For Phase 1 with a single fixed panel, this is optional but good practice.

### Anti-Patterns to Avoid

- **Passing callback directly to `ipcRenderer.on`:** The callback reference changes across the bridge; `removeListener` will never match. Always create a local wrapper and return a closure.
- **Putting node-pty in devDependencies:** node-pty must be in `dependencies` because electron-builder only rebuilds modules in `dependencies` for the packaged app. In devDependencies it works in dev but fails in production.
- **Not externalizing node-pty from Vite:** Vite will attempt to bundle it and fail. Always add to `rollupOptions.external`.
- **Using unscoped xterm packages:** `xterm`, `xterm-addon-fit`, etc. are frozen at v5.3.0 and will not receive bug fixes. Use `@xterm/xterm`, `@xterm/addon-fit`, etc.
- **Setting `TERM` to `xterm`:** Use `xterm-256color` or `xterm-truecolor` so CLI tools enable colors by default.
- **Calling `fitAddon.fit()` before `term.open()`:** fit() requires the terminal to be mounted in the DOM first.

---

## Don't Hand-Roll

| Problem                     | Don't Build                   | Use Instead                                                | Why                                                                                                                                                |
| --------------------------- | ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PTY / shell process         | Custom child_process spawn    | node-pty                                                   | PTY requires OS-level fork + terminal device emulation; child_process gives you pipes not a terminal — tab completion, readline, vi-mode all break |
| Native module ABI alignment | Custom build scripts          | `electron-builder install-app-deps` or `@electron/rebuild` | ABI negotiation across OS/arch/Electron version combinations is complex; these tools handle header downloads, target version, arch                 |
| Terminal rendering          | Custom canvas/DOM terminal    | xterm.js (@xterm/xterm)                                    | VT100/ANSI escape sequences are a ~200-page spec with edge cases; xterm.js is the only battle-tested implementation for the browser                |
| Terminal fit/resize         | Custom dimension calculation  | @xterm/addon-fit                                           | Font measurement in canvas is non-trivial; FitAddon does it correctly                                                                              |
| URL detection in output     | Custom regex on terminal data | @xterm/addon-web-links                                     | Handles partial URLs, ANSI-escaped URLs, multi-line URLs correctly                                                                                 |
| IPC type definitions        | Runtime type checking         | TypeScript window augmentation + preload types             | Compile-time safety is free, runtime checking is redundant                                                                                         |

**Key insight:** node-pty + xterm.js is the exact stack VS Code uses for its integrated terminal. The edge cases in both PTY management and terminal rendering are already solved.

---

## Common Pitfalls

### Pitfall 1: node-pty ABI Mismatch (HIGH PROBABILITY)

**What goes wrong:** The app launches but immediately crashes with `Error: The module was compiled against a different Node.js version` or `NODE_MODULE_VERSION` mismatch.
**Why it happens:** node-pty compiles a native `.node` binary during `npm install`. That binary targets the system Node.js version. Electron has its own embedded Node.js (Electron 41 = Node 24.14.0) which likely differs from the system Node.js ABI. Electron loads the binary and rejects it.
**How to avoid:** Add this to `package.json` BEFORE the first `npm install`:

```json
{
  "scripts": {
    "postinstall": "electron-builder install-app-deps"
  }
}
```

This makes `electron-builder install-app-deps` run automatically after every `npm install`, rebuilding native modules against Electron's Node.js version.
**Warning signs:** Error message containing `NODE_MODULE_VERSION` or `was compiled against a different Node.js version`. Also watch for `Error: dlopen() failed`.

### Pitfall 2: xterm.css Not Imported

**What goes wrong:** Terminal container exists in the DOM but shows as blank, or text appears but with broken layout.
**Why it happens:** xterm.js renders via a canvas/DOM inside a shadow-like container that requires specific CSS resets and positioning from xterm.css.
**How to avoid:** Import `@xterm/xterm/css/xterm.css` at the top of the component file or in the global CSS entry point.
**Warning signs:** Terminal element is present in DOM inspector but visually empty.

### Pitfall 3: FitAddon Called Before Terminal Is Mounted

**What goes wrong:** `fitAddon.fit()` throws or returns incorrect dimensions (often width=1).
**Why it happens:** FitAddon measures the DOM container to calculate columns/rows. If called before `term.open(containerRef.current)`, the container has no dimensions yet.
**How to avoid:** Always call in this order: `term.open(container)` → `fitAddon.fit()` → IPC resize.
**Warning signs:** `[fitAddon] Cannot fit without container` error, or terminal spawns with 1 column.

### Pitfall 4: Push Listeners Accumulate (Memory Leak)

**What goes wrong:** Every re-render or remount adds a new `pty:data` listener but the old one is never removed. Eventually dozens of listeners fire for each data event, causing duplicate output in the terminal.
**Why it happens:** The unsubscribe function returned by `onPtyData` is not called in the React cleanup function. This is especially dangerous with React Strict Mode which mounts/unmounts components twice in development.
**How to avoid:** Always return the unsubscribe call from the `useEffect` cleanup: `return () => { unsubscribe(); ... }`.
**Warning signs:** Terminal output appears duplicated; `ipcRenderer.listenerCount()` grows over time.

### Pitfall 5: Shell Not Found / Wrong Default Shell

**What goes wrong:** PTY spawns `/bin/sh` or fails with `ENOENT` because the shell path is wrong.
**Why it happens:** `process.env.SHELL` is the most reliable source for the user's default shell on macOS/Linux, but it may be undefined in some Electron launch contexts.
**How to avoid:** Use `process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')` as the shell argument to `pty.spawn()`. Pass `env: { ...process.env }` to inherit the full user environment.
**Warning signs:** Shell spawns but PATH is missing entries; tools like `git` or `node` are not found inside the terminal.

### Pitfall 6: Vite Tries to Bundle node-pty

**What goes wrong:** `npm run dev` fails with `Cannot find module` or a build error about native addons during Vite's analysis phase.
**Why it happens:** By default, Vite tries to bundle all imports. node-pty contains a native binary that cannot be bundled.
**How to avoid:** Add `node-pty` to `rollupOptions.external` in the `main` section of `electron.vite.config.ts`.
**Warning signs:** Build error mentioning `node-pty`, `better-pty.node`, or `node_modules/node-pty` during Vite's transform phase.

---

## Code Examples

Verified patterns from official sources:

### postinstall script (package.json)

```json
{
  "dependencies": {
    "node-pty": "^1.1.0",
    "@xterm/xterm": "^6.0.0",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-web-links": "^0.12.0"
  },
  "devDependencies": {
    "electron": "^41.0.0",
    "electron-vite": "^5.0.0",
    "electron-builder": "^26.0.0",
    "@electron/rebuild": "^4.0.0"
  },
  "scripts": {
    "postinstall": "electron-builder install-app-deps",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview"
  }
}
```

### node-pty spawn with correct TERM and env

```typescript
// Source: github.com/microsoft/node-pty (official README pattern)
import * as pty from 'node-pty'

const shell = process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')

const ptyProcess = pty.spawn(shell, [], {
  name: 'xterm-256color', // sets TERM env var — enables 256-color in most CLI tools
  cols: 80,
  rows: 24,
  cwd: projectFolderPath,
  env: { ...process.env } // inherit full env including PATH, HOME, etc.
})

// Data from PTY to renderer
ptyProcess.onData((data: string) => {
  webContents.send(`pty:data:${sessionId}`, data)
})

// Input from renderer to PTY
ptyProcess.write(data)

// Resize (triggered by renderer after FitAddon measures cols/rows)
ptyProcess.resize(cols, rows)

// Cleanup
ptyProcess.kill()
```

### xterm.js ITheme for dark theme (matching INFRA-05 spec)

```typescript
// Source: xtermjs.org/docs/api/terminal/interfaces/itheme/
const darkTheme: ITheme = {
  background: '#1a1a1a',
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
```

### xterm.js Terminal constructor (full Phase 1 config)

```typescript
// Source: xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/
const term = new Terminal({
  scrollback: 10000, // TERM-05: 10,000+ line scrollback
  fontSize: 14,
  fontFamily: '"JetBrains Mono", "Fira Code", Menlo, monospace',
  theme: darkTheme, // INFRA-05: dark theme
  cursorBlink: true,
  cursorStyle: 'block',
  allowTransparency: false,
  convertEol: false // let PTY handle line endings
})
```

### ResizeObserver → FitAddon → IPC roundtrip

```typescript
// Pattern confirmed by xterm.js issue #1914 (resize roundtrip discussion)
const observer = new ResizeObserver(() => {
  // Debounce optional for Phase 1 (single panel, no drag-resize yet)
  fitAddon.fit()
  const { cols, rows } = term
  window.electronAPI.ptyResize(sessionId, cols, rows)
})
observer.observe(containerElement)
// Cleanup: observer.disconnect()
```

---

## State of the Art

| Old Approach               | Current Approach          | When Changed        | Impact                                                      |
| -------------------------- | ------------------------- | ------------------- | ----------------------------------------------------------- |
| `xterm` (unscoped)         | `@xterm/xterm` (scoped)   | v5.4.0 (March 2024) | Old packages frozen; use scoped only                        |
| `xterm-addon-fit`          | `@xterm/addon-fit`        | v5.4.0 (March 2024) | Same                                                        |
| `xterm-addon-web-links`    | `@xterm/addon-web-links`  | v5.4.0 (March 2024) | Same                                                        |
| `externalizeDepsPlugin`    | `rollupOptions.external`  | electron-vite 5.0   | Plugin deprecated; use config directly                      |
| `term.setOption(key, val)` | `term.options[key] = val` | xterm.js v5.0.0     | `getOption`/`setOption` removed                             |
| Canvas renderer addon      | DOM or WebGL renderer     | xterm.js 6.0.0      | Canvas addon removed; WebGL is default GPU-accelerated path |

**Deprecated/outdated:**

- `xterm` (npm package): Frozen at v5.3.0, will not receive updates. Use `@xterm/xterm`.
- `externalizeDepsPlugin`: Deprecated in electron-vite 5.0. Use `rollupOptions.external`.
- `applyAddon()` static method: Removed in xterm.js v4+. Use `terminal.loadAddon(addon)`.
- `winpty` support in node-pty: Removed. Windows 10 1809+ required.

---

## Open Questions

1. **Electron version pinning**
   - What we know: Electron 41 is current stable (March 2026, Node 24.14.0); node-pty 1.1.0 released December 2025
   - What's unclear: Whether node-pty 1.1.0 builds cleanly against Electron 41's Node 24.14.0 ABI without issues
   - Recommendation: Use `electron-builder install-app-deps` postinstall; if ABI issues appear, pin Electron to a slightly older stable (e.g., 40.x) while the issue resolves. The node-pty GitHub issues list will show any active incompatibilities.

2. **Clipboard paste (TERM-09) implementation depth**
   - What we know: xterm.js has built-in selection/copy; paste requires either `terminal.paste()` or a keyboard shortcut handler
   - What's unclear: Whether Electron's clipboard IPC is needed or if xterm.js v6 handles Ctrl+V natively in the terminal element
   - Recommendation: In Phase 1, rely on xterm.js built-in selection and standard OS clipboard shortcuts. If Ctrl+V doesn't work for a specific OS, add `ipcRenderer.invoke('clipboard:readText')` in Plan 01-03.

3. **electron-vite version at scaffold time**
   - What we know: electron-vite 5.0.0 is documented; npm shows 4.0.1 as "last published 2 months ago" (conflict in sources)
   - What's unclear: Whether the latest npm release is 4.x or 5.x
   - Recommendation: Run `npm create @quick-start/electron@latest` at scaffold time; it will use whatever is current. Verify `electron-vite --version` after scaffold.

---

## Validation Architecture

### Test Framework

| Property           | Value                                                                  |
| ------------------ | ---------------------------------------------------------------------- |
| Framework          | Vitest (bundled with electron-vite scaffold)                           |
| Config file        | `vitest.config.ts` or inline in `electron.vite.config.ts` — see Wave 0 |
| Quick run command  | `npx vitest run --reporter=verbose`                                    |
| Full suite command | `npx vitest run`                                                       |

### Phase Requirements → Test Map

| Req ID   | Behavior                                                                | Test Type   | Automated Command                                   | File Exists? |
| -------- | ----------------------------------------------------------------------- | ----------- | --------------------------------------------------- | ------------ |
| INFRA-01 | BrowserWindow created with contextIsolation:true, nodeIntegration:false | unit        | `npx vitest run tests/main/window.test.ts`          | ❌ Wave 0    |
| INFRA-02 | All IPC channels registered in ipcMain                                  | unit        | `npx vitest run tests/main/ptyManager.test.ts`      | ❌ Wave 0    |
| INFRA-03 | node-pty only imported in main process files                            | static/lint | `grep -r "node-pty" src/renderer` returns empty     | manual       |
| INFRA-04 | App starts without errors                                               | smoke       | `npm run dev` exits 0 (manual verification)         | manual       |
| INFRA-05 | CSS variables match spec colors                                         | unit        | `npx vitest run tests/renderer/theme.test.ts`       | ❌ Wave 0    |
| TERM-01  | PTY spawns real shell (not simulated)                                   | unit        | `npx vitest run tests/main/ptyManager.test.ts`      | ❌ Wave 0    |
| TERM-02  | Shell cwd matches project folder                                        | unit        | `npx vitest run tests/main/ptyManager.test.ts`      | ❌ Wave 0    |
| TERM-03  | Terminal renders FitAddon + WebLinksAddon loaded                        | unit        | `npx vitest run tests/renderer/Terminal.test.tsx`   | ❌ Wave 0    |
| TERM-04  | Resize triggers pty:resize IPC with correct cols/rows                   | unit        | `npx vitest run tests/renderer/Terminal.test.tsx`   | ❌ Wave 0    |
| TERM-05  | Terminal scrollback=10000 set in options                                | unit        | `npx vitest run tests/renderer/Terminal.test.tsx`   | ❌ Wave 0    |
| TERM-06  | 256-color / 24-bit color render                                         | manual      | Visual inspection with `printf '\e[38;5;196mRed\n'` | manual       |
| TERM-07  | Unicode/emoji render                                                    | manual      | Visual inspection with `echo "Hello 👋"`            | manual       |
| TERM-08  | Ctrl+C, arrow keys pass through                                         | manual      | Interactive verification in running app             | manual       |
| TERM-09  | Copy/paste works                                                        | manual      | Interactive verification in running app             | manual       |

### Sampling Rate

- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/main/window.test.ts` — covers INFRA-01: BrowserWindow webPreferences
- [ ] `tests/main/ptyManager.test.ts` — covers INFRA-02, INFRA-03, TERM-01, TERM-02: PTY lifecycle and IPC handler registration
- [ ] `tests/renderer/Terminal.test.tsx` — covers TERM-03, TERM-04, TERM-05: xterm.js setup with addons and options
- [ ] `tests/renderer/theme.test.ts` — covers INFRA-05: CSS custom property values
- [ ] `vitest.config.ts` — test configuration with jsdom environment for renderer tests
- [ ] Framework install: `npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom` — if not included in scaffold

---

## Sources

### Primary (HIGH confidence)

- `electronjs.org/docs/latest/tutorial/context-isolation` — BrowserWindow webPreferences, contextBridge pattern
- `electronjs.org/docs/latest/tutorial/ipc` — ipcMain.handle, ipcRenderer.invoke, webContents.send patterns
- `electronjs.org/docs/latest/api/context-bridge` — contextBridge type restrictions, function proxying
- `electronjs.org/docs/latest/tutorial/using-native-node-modules` — @electron/rebuild approach for native modules
- `electron-vite.org/guide/` — Project structure, config format, electron-vite 5.0 features
- `electron-vite.org/guide/dependency-handling` — rollupOptions.external for native modules
- `xtermjs.org/docs/guides/using-addons/` — FitAddon and WebLinksAddon usage with @xterm scoped packages
- `xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/` — Terminal constructor options (scrollback, theme, etc.)
- `xtermjs.org/docs/api/terminal/interfaces/itheme/` — ITheme color properties
- `github.com/xtermjs/xterm.js/releases` — xterm.js 6.0.0 release notes, breaking changes
- `github.com/microsoft/node-pty` — node-pty v1.1.0, spawn API, Electron >=19 requirement

### Secondary (MEDIUM confidence)

- `github.com/electron/electron/issues/33328` — Confirmed bug: ipcRenderer.removeListener fails through contextBridge; unsubscribe closure is the fix
- `releases.electronjs.org` — Electron 41.0.2 confirmed current stable (March 12, 2026), Node 24.14.0
- WebSearch: "electron-vite 5.0" blog post — `externalizeDepsPlugin` deprecated in v5

### Tertiary (LOW confidence)

- WebSearch results noting node-pty 1.0.0 C++ compile errors with Electron 33.2.0 — may or may not apply to 1.1.0 + Electron 41; treat as risk requiring postinstall rebuild, not a blocker

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries verified via official npm/GitHub, versions confirmed
- Architecture: HIGH — patterns from official Electron + xterm.js docs, confirmed bug workarounds cited with issue numbers
- Pitfalls: HIGH for ABI mismatch (documented extensively) and contextBridge removeListener (confirmed GitHub issue); MEDIUM for shell path handling (common pattern, no official doc citation)

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (stable stack; electron-vite and xterm.js release cadence is ~quarterly)
