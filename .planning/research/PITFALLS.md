# Pitfalls Research

**Domain:** Electron desktop terminal application (node-pty + xterm.js + react-mosaic + electron-vite)
**Researched:** 2026-03-14
**Confidence:** HIGH (multiple verified sources, official docs, GitHub issues, active maintainer discussions)

---

## Critical Pitfalls

### Pitfall 1: node-pty Not Externalized from Vite Bundle

**What goes wrong:**
electron-vite uses Vite/Rollup under the hood. By default Vite tries to bundle all imports — but node-pty is a C++ native module (`.node` binary). Vite cannot bundle it, so the build fails or produces a broken output that crashes on startup with a cryptic module-not-found error.

**Why it happens:**
Developers scaffold with electron-vite, add `node-pty` as a dependency, then run the build without configuring Rollup externals. Vite's bundler silently fails to include the binary or corrupts the require path.

**How to avoid:**
In `electron.vite.config.ts`, explicitly mark node-pty as external for the main process build:

```typescript
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  }
})
```

Also ensure `node-pty` is under `dependencies` (not `devDependencies`) in `package.json` so electron-builder includes it in the packaged output.

**Warning signs:**

- `Error: Cannot find module 'node-pty'` at runtime after a clean build
- App works in dev (`electron-vite dev`) but fails after `electron-vite build`
- Build output does not contain a `node_modules/node-pty` directory

**Phase to address:** Project scaffolding / Phase 1 (core PTY integration). Verify in the very first spike that PTY spawns correctly in both dev and a preview build.

---

### Pitfall 2: node-pty Not Rebuilt Against Electron's ABI

**What goes wrong:**
node-pty compiles to a native binary linked against Node.js's ABI. Electron ships its own Node runtime with a different ABI version. If node-pty is installed with plain `npm install` and never rebuilt against the Electron headers, you get a runtime error like: `Error: The module '...pty.node' was compiled against a different Node.js version`.

**Why it happens:**
Running `npm install` compiles node-pty for the system's Node binary, not Electron's. This is silent — the install succeeds, the binary exists, but it cannot be loaded by Electron.

**How to avoid:**
Add a `postinstall` script that rebuilds native modules for Electron's ABI:

```json
"scripts": {
  "postinstall": "electron-builder install-app-deps"
}
```

Or use `@electron/rebuild` directly:

```bash
npx @electron/rebuild -f -w node-pty
```

Run this after any `npm install` that touches native dependencies.

**Warning signs:**

- `Error: The module '...pty.node' was compiled against a different Node.js version using NODE_MODULE_VERSION X. This version of Node.js requires NODE_MODULE_VERSION Y.`
- Works with `node` directly but fails inside Electron
- CI passes but local dev fails (or vice versa) when Node/Electron versions differ

**Phase to address:** Phase 1 (core PTY integration). Make rebuild part of the `postinstall` script before any other development begins.

---

### Pitfall 3: ASAR Packaging Breaks node-pty Binaries on Windows

**What goes wrong:**
On Windows, node-pty uses `winpty.dll` and a `spawn-helper` executable. When the app is packaged into an ASAR archive, these binaries are trapped inside the archive and cannot be executed (OS cannot `exec` files inside ASAR). The result: the app works in dev and even in a local unsigned build, but fails completely on Windows for packaged distribution builds.

**Why it happens:**
Electron auto-detects `.node` files for ASAR unpacking, but `spawn-helper` is a standalone `.exe` — it is not a `.node` file and is therefore NOT auto-unpacked. `winpty.dll` faces the same issue.

**How to avoid:**
Configure electron-builder to unpack node-pty's entire directory:

```yaml
# electron-builder.yml
asarUnpack:
  - '**/node_modules/node-pty/**'
```

Verify the packaged `app.asar.unpacked/node_modules/node-pty/` directory contains `spawn-helper.exe` and `winpty.dll`.

**Warning signs:**

- Terminal works on macOS/Linux builds but not Windows
- Windows packaged build logs: `posix_spawnp failed` or `ConnectNamedPipe failed`
- No errors in dev mode, errors only in production

**Phase to address:** Packaging / distribution phase. Flag this explicitly when setting up the electron-builder config. Test on Windows early — do not leave Windows validation to the end.

---

### Pitfall 4: xterm.js `terminal.open()` Called Before DOM Element Is Attached

**What goes wrong:**
`terminal.open(element)` requires the `element` to already be attached to the live DOM. If called during a React render cycle (before the component is mounted), or inside a conditional render that hasn't committed yet, the terminal opens into a detached element. The terminal renders blank — no errors thrown, just silence.

**Why it happens:**
Developers call `open()` in the wrong lifecycle stage — often in the body of a component function or in a `useEffect` that runs before layout paint. React Strict Mode (double-invocation in development) also causes `open()` to be called twice, which triggers a separate xterm bug where the second `open()` call does not render correctly.

**How to avoid:**

- Always initialize and open the terminal inside `useEffect` with a `useRef` pointing to the container div
- Call `open()` only after confirming the `ref.current` is non-null
- Call `terminal.dispose()` in the `useEffect` cleanup function to prevent double-open issues in Strict Mode

```typescript
useEffect(() => {
  if (!containerRef.current) return;
  const term = new Terminal({ ... });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(containerRef.current);
  fitAddon.fit();
  return () => term.dispose();
}, []);
```

**Warning signs:**

- Terminal container renders as empty white/black box
- No errors in console
- Terminal works after a hot reload but not on initial render
- FitAddon returns `cols: 0` or `rows: 0`

**Phase to address:** Phase 1 (terminal panel component). Build and verify the single-panel render before wiring in PTY.

---

### Pitfall 5: FitAddon Resize / PTY Size Mismatch Causes Garbled Output

**What goes wrong:**
The xterm.js terminal has a character dimension (cols × rows). The node-pty process also tracks dimensions. When a panel is resized by react-mosaic drag, if the PTY dimensions are not updated to match xterm's new dimensions, the shell's line wrapping breaks. Text wraps at the wrong column, prompts appear on wrong lines, and programs like `vim`, `htop`, or `less` render garbage.

**Why it happens:**
Developers wire up FitAddon correctly for the initial render but forget to trigger `fitAddon.fit()` followed by `pty.resize(cols, rows)` when the panel size changes. react-mosaic triggers layout changes through its `onChange` callback — this does NOT automatically trigger a browser resize event.

**How to avoid:**

- Use a `ResizeObserver` on each terminal container div, not `window.resize`
- In the observer callback: call `fitAddon.fit()`, then send `pty:resize` IPC with the new cols/rows
- Debounce at ~50ms to avoid thrashing during drag

```typescript
const ro = new ResizeObserver(() => {
  fitAddon.fit()
  ipcRenderer.invoke('pty:resize', { id, cols: term.cols, rows: term.rows })
})
ro.observe(containerRef.current)
return () => ro.disconnect()
```

**Warning signs:**

- Shell commands produce misaligned output after resizing a panel
- `vim` or `htop` renders incorrectly after a panel split
- Terminal text wraps earlier or later than expected

**Phase to address:** Phase 2 (multi-panel layout). Implement ResizeObserver when first adding react-mosaic, before testing any interactive programs.

---

### Pitfall 6: IPC Listener Accumulation (Memory Leak)

**What goes wrong:**
Each terminal panel registers a `pty:data` listener on `ipcRenderer` to receive output from the PTY. If the listener is not removed when the panel is closed or the component unmounts, the listener accumulates. With each new panel open/close cycle, the old listeners pile up. Each listener holds a reference to its closure (including the xterm terminal object), preventing GC. The app slowly consumes more memory over time.

**Why it happens:**
Electron's `ipcRenderer.on()` does not auto-remove listeners on component unmount. When passing listeners through `contextBridge`, the proxy wrapping changes function identity, meaning `ipcRenderer.removeListener(channel, fn)` with the same function reference does not actually remove the listener (the proxied function is a different object each time).

**How to avoid:**

- Return an unsubscribe function from the preload's contextBridge exposure:

```typescript
// preload.ts
contextBridge.exposeInMainWorld('api', {
  onPtyData: (id: string, callback: (data: string) => void) => {
    const handler = (_: IpcRendererEvent, data: string) => callback(data)
    ipcRenderer.on(`pty:data:${id}`, handler)
    return () => ipcRenderer.removeListener(`pty:data:${id}`, handler)
  }
})
```

- In the React component: store the unsubscribe function returned by `onPtyData` and call it in `useEffect` cleanup

**Warning signs:**

- Memory usage climbs monotonically as panels are opened and closed
- Console warning: `MaxListenersExceededWarning: Possible EventEmitter memory leak detected`
- After closing all panels, heap remains elevated

**Phase to address:** Phase 1 (PTY IPC wiring). The unsubscribe pattern must be established from the very first IPC listener added — retrofitting it later is error-prone.

---

### Pitfall 7: macOS PATH Truncation — Shell Tools Missing in Packaged App

**What goes wrong:**
When a developer launches the app from the terminal during development, Electron inherits the shell's full `PATH` (including `/opt/homebrew/bin`, `/usr/local/bin`, custom NVM paths, etc.). In the packaged app launched from Finder/Dock, macOS launches the process via `launchd` which provides only a minimal OS `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`). Homebrew tools (`git`, `node`, `python`, `brew`) are not on this PATH, so they are not found when spawned inside node-pty terminal panels.

**Why it happens:**
macOS GUI apps launched outside a terminal session do not source `.zshrc` / `.bash_profile` / `.zprofile`. The environment is bare. This only manifests in packaged builds — dev mode works fine because it is launched from a terminal.

**How to avoid:**
Use the `shell-env` or `fix-path` npm package to source the user's interactive shell environment before spawning PTY processes:

```typescript
import { fixPath } from 'fix-path'
app.whenReady().then(() => {
  fixPath() // Must be called before any process.env.PATH usage
  // ... rest of app init
})
```

Alternatively, spawn a login shell by passing `--login` to the shell argument, which sources profile files.

**Warning signs:**

- `git`, `node`, `brew`, `python` not found in terminal panels in production
- Works on developer machine (via terminal) but not on other users' machines
- `which git` returns nothing in the panel but works in macOS Terminal.app

**Phase to address:** Phase 1 (shell session spawning). Test with a freshly opened macOS app (not launched from terminal) before calling any phase complete.

---

### Pitfall 8: PTY Processes Not Killed on Window/App Close (Zombie Processes)

**What goes wrong:**
When the user closes the app (or closes a panel), child processes spawned by node-pty continue running as zombies. Each opened terminal panel that ran a long-lived command (dev server, test watcher, etc.) leaves an orphaned process. On macOS/Linux, `SIGHUP` propagates to foreground process groups, but background processes and processes that ignore signals survive. On Windows, there is no signal propagation — all subprocesses are orphaned.

**Why it happens:**
Developers call `ptyProcess.kill()` in the `app.on('before-quit')` handler, but this only handles the top-level shell. Subprocesses spawned by the shell that are backgrounded, in a different process group, or that ignore `SIGHUP` continue running. On Windows, native processes do not receive Unix signals at all.

**How to avoid:**

- Track all `IPtyProcess` instances in a `Map<string, IPtyProcess>` in the main process
- On `app.on('before-quit')` and `ipcMain.handle('pty:kill')`: call `pty.kill()` for all tracked processes
- Wrap kill calls in try/catch (process may already be dead)
- For Windows: implement process group termination via `taskkill /F /T /PID <pid>`

```typescript
app.on('before-quit', () => {
  for (const [, pty] of ptyMap) {
    try {
      pty.kill()
    } catch {}
  }
})
```

**Warning signs:**

- `Activity Monitor` (macOS) shows shell processes after app quit
- App re-launch shows "address already in use" because a dev server from a prior session is still running
- Repeated app open/close cycles slowly accumulate processes

**Phase to address:** Phase 2 (multi-panel lifecycle). Implement the PTY registry and cleanup in the same phase that adds panel close/remove functionality.

---

### Pitfall 9: Exposing Raw IPC in contextBridge (Security Footgun)

**What goes wrong:**
The project correctly mandates `contextIsolation: true` and `nodeIntegration: false`. But if the preload exposes a broad IPC interface — such as passing `ipcRenderer.send` or `ipcRenderer.invoke` directly — any content running in the renderer (including injected scripts if there were ever an XSS vector) can send arbitrary IPC messages to the main process. For a local terminal app this is lower risk than a remote-loading app, but it still violates the project's security model.

**Why it happens:**
Developers find the narrow-API approach verbose and expose broad helpers like `send: (channel, ...args) => ipcRenderer.send(channel, ...args)` to avoid writing per-channel wrappers. This is explicitly called out as dangerous in the Electron security docs.

**How to avoid:**
Expose one typed function per IPC channel. The allowed channel list is already specified in `PROJECT.md` (`pty:create`, `pty:write`, `pty:resize`, `pty:kill`, `pty:data`, `pty:attention`, `folder:open`, `folder:readdir`). Each gets its own named method on the contextBridge object with typed parameters.

```typescript
contextBridge.exposeInMainWorld('api', {
  ptyCreate: (options: PtyOptions) => ipcRenderer.invoke('pty:create', options),
  ptyWrite: (id: string, data: string) => ipcRenderer.invoke('pty:write', { id, data })
  // ...
})
```

On the main process side, validate sender with `event.senderFrame.url` for sensitive operations.

**Warning signs:**

- Preload exports `send`, `invoke`, `on` directly wrapping `ipcRenderer` methods
- Main process ipcMain handlers do not validate message content
- A single handler accepts arbitrary channel strings

**Phase to address:** Phase 1 (IPC scaffolding). Establish the narrow contextBridge API from the start — never expose raw ipcRenderer.

---

## Technical Debt Patterns

| Shortcut                                           | Immediate Benefit            | Long-term Cost                                                             | When Acceptable              |
| -------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------- | ---------------------------- |
| Skip `postinstall` rebuild script                  | Faster initial setup         | App crashes on Electron version bump; CI failures on clean builds          | Never                        |
| Use `uncontrolled` mode in react-mosaic            | Simpler initial code         | Cannot serialize/restore layout; breaks persistence feature                | Only for throwaway prototype |
| Attach `window.resize` instead of `ResizeObserver` | One listener for all panels  | Misses panel size changes from mosaic drag (not a window resize)           | Never for multi-panel        |
| Expose raw `ipcRenderer.send` via contextBridge    | Less boilerplate             | Security footgun; violates stated project constraints                      | Never                        |
| Skip PTY cleanup on close                          | Simpler code                 | Zombie processes accumulate; potential port conflicts on re-launch         | Never                        |
| Hardcode shell path (`/bin/zsh`)                   | Avoids shell detection logic | Fails on Windows, fails on NixOS, fails for users with non-standard shells | Never for cross-platform     |
| Call `fitAddon.fit()` without PTY resize IPC       | Simpler resize handling      | PTY and xterm dimensions diverge; garbled output in vim/htop               | Never                        |

---

## Integration Gotchas

| Integration                                | Common Mistake                                            | Correct Approach                                                                           |
| ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| node-pty + electron-vite                   | Letting Vite try to bundle `node-pty`                     | Mark as external in `rollupOptions.external`; keep in `dependencies` not `devDependencies` |
| node-pty + electron-builder                | Relying on auto-detect for ASAR unpack                    | Explicitly set `asarUnpack: ["**/node_modules/node-pty/**"]` in builder config             |
| xterm.js + React                           | Calling `terminal.open()` outside `useEffect`             | Always open inside `useEffect`, clean up with `terminal.dispose()` in cleanup return       |
| FitAddon + react-mosaic                    | Listening to `window.resize` for panel size changes       | Use `ResizeObserver` on each panel's container div                                         |
| contextBridge + ipcRenderer.removeListener | Calling `removeListener` with the same callback reference | Capture the handler in preload scope; expose an unsubscribe closure                        |
| shell spawn + macOS packaged app           | Assuming inherited `PATH` contains Homebrew               | Use `fix-path` or spawn a login shell; test in packaged mode, not dev mode                 |
| zustand + electron IPC                     | Storing PTY process references in zustand (renderer-side) | Keep `IPtyProcess` objects only in main process Map; zustand holds panel metadata only     |

---

## Performance Traps

| Trap                                                         | Symptoms                                                                                       | Prevention                                                                              | When It Breaks                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Synchronous IPC calls (`ipcRenderer.sendSync`)               | UI thread freezes during shell operations                                                      | Use `ipcRenderer.invoke` (async) for all PTY channels                                   | Immediately noticeable with any IO-heavy command             |
| xterm.js main-thread saturation with 4+ panels doing high-IO | UI becomes sluggish; 60fps drops to <20fps during `cat bigfile`                                | Throttle PTY output in main process (buffer and batch sends ~16ms); enable WebGL addon  | With 4+ active panels running high-throughput commands       |
| Unbatched IPC for pty:data events                            | Thousands of IPC round-trips per second for each panel                                         | Batch data chunks in main process before sending; send at ~60Hz interval                | Any command with continuous output (build tools, log tails)  |
| Large scrollback buffer × many panels                        | High memory usage (single 160×24 terminal with 5000-line scrollback ≈ 34MB; 6 panels = 200MB+) | Use conservative default scrollback (e.g., 1000 lines); make it configurable            | With default 10000-line scrollback × 4 panels open long-term |
| React reconciliation on every PTY data event                 | Unnecessary re-renders of panel tree for data that only xterm needs                            | Write PTY data directly to xterm (`term.write(data)`) — never route through React state | Any panel with continuous output                             |

---

## Security Mistakes

| Mistake                                                                               | Risk                                                                                | Prevention                                                                                            |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Exposing raw `ipcRenderer.invoke` via contextBridge                                   | Renderer can invoke any IPC channel; escalates any XSS to arbitrary shell execution | One typed method per channel; no generic `invoke(channel, ...args)`                                   |
| Not validating IPC sender in main process                                             | Malicious iframe or child window could send PTY commands                            | Check `event.senderFrame.url` or use `webContents.id` allowlist                                       |
| Passing entire `process.env` to spawned shell (contains secrets from dev environment) | Secrets in env vars leak into child processes                                       | Pass only required env vars to PTY spawn; or pass current user's interactive shell env via `fix-path` |
| Enabling `nodeIntegration: true` as a "quick fix" for xterm/PTY setup                 | Full Node access from renderer; complete security bypass                            | Keep `nodeIntegration: false`; fix the actual issue (likely bad IPC wiring)                           |
| Using `shell: true` in node-pty spawn for convenience                                 | Shell injection if any user input is ever concatenated into the command string      | Use `shell: false`; pass shell binary path and args array separately                                  |

---

## UX Pitfalls

| Pitfall                                                                        | User Impact                                                            | Better Approach                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| New terminal panel opens in app's working directory, not project folder        | User immediately has to `cd` to the project                            | Always spawn PTY with `cwd` set to the project folder stored in app state                                              |
| Attention badge fires on every `?` in terminal output (false positive)         | Badge pulses constantly for `y/n` prompts, grep output, comments       | Match against multi-character prompts (`"? "`, `"> "`, `"Do you want"`) not single chars; debounce detection per panel |
| Layout saves on every mosaic `onChange` event (fires continuously during drag) | Excessive disk writes during resize dragging; possible file corruption | Debounce JSON write by 300–500ms after mosaic `onChange`                                                               |
| Terminal font renders blurry at non-integer device pixel ratios                | Text difficult to read on HiDPI/Retina displays                        | Pass `devicePixelRatio` to xterm's `Terminal` constructor; use CSS `font-smooth` appropriately                         |
| Panel close removes the terminal immediately without killing the PTY           | User sees blank panel briefly; PTY process zombies                     | Kill PTY first via IPC, await confirmation, then remove panel from mosaic tree                                         |
| react-mosaic "empty" state when last panel is closed                           | Renders a blank frame with no affordance to add a new terminal         | Handle the `null` mosaic value explicitly — show an empty state with a prominent "+ New Terminal" CTA                  |

---

## "Looks Done But Isn't" Checklist

- [ ] **PTY cleanup:** Terminal panels can be opened and closed 10 times without zombie processes accumulating — verify with `ps aux | grep -v grep | grep -c bash` before and after
- [ ] **Resize correctness:** After dragging mosaic divider, `vim` and `htop` open and render without layout artifacts — `cols`/`rows` match the container
- [ ] **Layout persistence:** App can be closed and reopened 3 times; panel layout and titles are restored exactly — verify with an unusual panel arrangement
- [ ] **macOS packaged PATH:** `which git`, `which node`, `which brew` all resolve in a terminal panel launched from the Finder-opened app — not just from dev mode
- [ ] **Windows ASAR unpack:** Terminal spawns successfully on a Windows machine from a packaged installer — `winpty.dll` and `spawn-helper.exe` are present in `app.asar.unpacked`
- [ ] **IPC listener cleanup:** Opening 20 panels sequentially does not trigger `MaxListenersExceededWarning` — verify in dev console
- [ ] **Attention detection:** Pulsing badge fires for `npm init`-style `?` prompts but NOT for `grep "?"` output — check false-positive rate
- [ ] **Scrollback memory:** With 4 panels open for 30 minutes running build watchers, memory usage is not >500MB — check in Activity Monitor

---

## Recovery Strategies

| Pitfall                                                 | Recovery Cost | Recovery Steps                                                                                                                     |
| ------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Vite bundling of node-pty discovered post-scaffolding   | LOW           | Add `rollupOptions.external: ['node-pty']` to `electron.vite.config.ts`; move to `dependencies`; re-run build                      |
| ABI mismatch discovered after Electron version bump     | LOW           | Add/run `postinstall` script with `electron-builder install-app-deps`                                                              |
| ASAR unpack issue discovered late in Windows testing    | MEDIUM        | Add `asarUnpack` glob in electron-builder config; rebuild and retest on Windows — no code changes needed                           |
| IPC listener leak discovered via memory profiling       | MEDIUM        | Refactor contextBridge to return unsubscribe closures; update all useEffect cleanups — affects every panel component               |
| Raw IPC exposure discovered in security review          | MEDIUM-HIGH   | Replace generic IPC helpers with typed per-channel methods; audit all preload exports and main-process handlers                    |
| PATH issue found in QA on packaged macOS build          | LOW           | Add `fix-path` package; call `fixPath()` in `app.whenReady()` before any shell spawn                                               |
| React state routing PTY data causing performance issues | HIGH          | Refactor data path to write directly to xterm (`term.write(data)`) bypassing React state — requires significant component rewiring |

---

## Pitfall-to-Phase Mapping

| Pitfall                                | Prevention Phase                   | Verification                                                                |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| node-pty not externalized from Vite    | Phase 1 — Scaffolding/PTY spike    | Build succeeds; `electron-vite preview` can spawn a shell                   |
| node-pty ABI mismatch                  | Phase 1 — Scaffolding/PTY spike    | `postinstall` runs; confirm with `@electron/rebuild --list-rebuild-modules` |
| ASAR packaging breaks Windows binaries | Packaging phase (last mile)        | Test packaged Windows build opens a terminal before shipping                |
| xterm.js open() before DOM attach      | Phase 1 — Terminal panel component | Single panel renders without blank output on first load                     |
| FitAddon / PTY size mismatch           | Phase 2 — Multi-panel layout       | vim/htop renders correctly after mosaic panel drag                          |
| IPC listener accumulation              | Phase 1 — IPC scaffolding          | No `MaxListenersExceededWarning` after 20 open/close cycles                 |
| macOS PATH truncation                  | Phase 1 — Shell spawn              | Packaged app (Finder-launched) resolves `git` in panel                      |
| Zombie PTY processes                   | Phase 2 — Panel lifecycle          | No orphan processes after closing all panels and quitting                   |
| Raw IPC in contextBridge               | Phase 1 — IPC scaffolding          | Code review: no `ipcRenderer.send/invoke` exported generically              |
| React state routing PTY data           | Phase 1 — Terminal panel component | xterm.write() called directly from IPC callback, not via setState           |
| Attention detection false positives    | Attention detection feature phase  | Test suite with known-good and known-bad output samples                     |
| Layout save debounce                   | Persistence phase                  | No disk writes during continuous drag; verified by watching file mtime      |

---

## Sources

- [node-pty GitHub: Instructions for using with Electron #422](https://github.com/microsoft/node-pty/issues/422)
- [node-pty GitHub: ASAR compatibility / winpty.dll #372](https://github.com/microsoft/node-pty/issues/372)
- [node-pty GitHub: Proper way to kill PTY in Electron #382](https://github.com/microsoft/node-pty/issues/382)
- [electron-vite Troubleshooting Guide](https://electron-vite.org/guide/troubleshooting)
- [electron-vite Dependency Handling](https://electron-vite.org/guide/dependency-handling)
- [Electron: Context Isolation official docs](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron: Security official docs](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron: Using Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- [xterm.js: FitAddon resize issues #4841](https://github.com/xtermjs/xterm.js/issues/4841)
- [xterm.js: Main thread performance with multiple instances #3368](https://github.com/xtermjs/xterm.js/issues/3368)
- [xterm.js: terminal.open() on unattached DOM #1158](https://github.com/xtermjs/xterm.js/issues/1158)
- [xterm.js: terminal.open() called twice breaks render #4978](https://github.com/xtermjs/xterm.js/issues/4978)
- [Electron: ipcRenderer.off does not remove listener #45224](https://github.com/electron/electron/issues/45224)
- [Electron: Memory leak passing IPC events over contextBridge #27039](https://github.com/electron/electron/issues/27039)
- [Electron Forge: Auto Unpack Native Modules Plugin](https://www.electronforge.io/config/plugins/auto-unpack-natives)
- [Electron: PATH is lost in production #5626](https://github.com/electron/electron/issues/5626)
- [Electron: Environment variables missing in built application (electron-builder #3363)](https://github.com/electron-userland/electron-builder/issues/3363)
- [npm: fix-path package](https://www.npmjs.com/package/fix-path)
- [react-mosaic README: controlled vs uncontrolled](https://github.com/nomcopter/react-mosaic/blob/master/README.md)
- [Electron Forge + node-pty (Thomas Deegan, Medium)](https://thomasdeegan.medium.com/electron-forge-node-pty-9dd18d948956)
- [Syncing State between Electron Contexts (Bruno Scheufler)](https://brunoscheufler.com/blog/2023-10-29-syncing-state-between-electron-contexts)

---

_Pitfalls research for: Electron terminal application (multiterm-studio)_
_Researched: 2026-03-14_
