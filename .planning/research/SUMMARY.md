# Project Research Summary

**Project:** multiterm-studio
**Domain:** Cross-platform desktop terminal multiplexer (Electron + React + node-pty)
**Researched:** 2026-03-14
**Confidence:** HIGH

## Executive Summary

Multiterm Studio is a project-scoped tiling terminal emulator built on Electron. The expert approach is a three-process Electron architecture — main process owns all Node-privileged operations (PTY management, filesystem, persistence), a preload script exposes a narrow typed API via contextBridge, and the renderer is a pure React/Chromium environment with zero Node access. This separation is not optional for a terminal app: any deviation (nodeIntegration, raw ipcRenderer exposure) creates a direct shell-execution attack surface. The stack is well-settled — Electron 41, electron-vite 5, xterm.js v6 (@xterm scope), node-pty 1.1.0, react-mosaic-component 6.1.1, and zustand 5 — with all versions verified as of research date.

The product has a genuine competitive angle: no existing terminal ties persistence, panel layout, and working directory automatically to a project folder. iTerm2, Warp, Tabby, and Wave Terminal all handle these concerns globally or manually. The full v1 feature set (PTY sessions, tiling layout, per-project persistence, output attention detection, file tree sidebar, color-coded panels) is achievable in a single focused build. The only risk to scope is the list of commonly-requested features that must be held out of v1: SSH, plugins, AI integration, global preferences UI, and cross-reboot session restoration.

The dominant build risk is infrastructure, not product design. node-pty has three sequential failure modes (Vite bundling, ABI mismatch, Windows ASAR packaging) that must each be explicitly resolved before any feature work begins. A second cluster of risks involves the IPC event bus: listener accumulation is a memory leak that is difficult to retrofit if not established from the first IPC listener. Getting these two concerns right in Phase 1 removes the highest-probability failure modes for the entire project.

---

## Key Findings

### Recommended Stack

The stack is narrow and purposeful. electron-vite 5 provides a unified build surface for all three Electron contexts (main, preload, renderer) with HMR, eliminating the overhead of coordinating separate Vite configs. xterm.js v6 (the `@xterm` scoped packages) is a complete API rewrite of the deprecated `xterm` package — it must be used; the old unscoped packages are frozen and insecure. react-mosaic-component is the only battle-tested React tiling library with binary-tree layout state and drag-to-resize; it has low maintenance cadence but a stable API with no viable alternative short of a ground-up rebuild. zustand's slice pattern maps cleanly to the panel-centric global state model; jotai's atom-per-unit approach is a mismatch here.

**Core technologies:**

- Electron 41.x — desktop shell, OS integration, Node runtime for main process
- electron-vite 5.x — unified build/dev tooling; requires Node 20.19+ or 22.12+
- React 18.x + TypeScript 5.x — renderer UI with strict mode enforced
- node-pty 1.1.0 (stable) — real PTY process spawning; main process only; requires `@electron/rebuild` postinstall
- @xterm/xterm 6.0.0 + addons (fit, web-links, webgl) — terminal emulator in renderer; GPU-accelerated via WebGL addon
- react-mosaic-component 6.1.1 — tiling layout; controlled component with binary-tree state
- zustand 5.x — global panel state; slice pattern; prevents unnecessary re-renders via selectors
- electron-builder 26.8.1 — cross-platform packaging; superior multi-OS support from single machine

**Critical version constraints:**

- Node.js 20.19+ or 22.12+ required by electron-vite 5
- Use `@xterm/*` scoped packages only — unscoped `xterm` and `xterm-addon-*` are deprecated
- `@electron/rebuild` (not the old `electron-rebuild` package) for native module ABI alignment

### Expected Features

Research confirmed the full v1 scope against 5 competitors (iTerm2, Warp, Wave Terminal, Tabby, Windows Terminal). All planned features are either table stakes or genuine differentiators with no competitive equivalent in the project-scoped category.

**Must have (table stakes):**

- Real PTY shell session per panel — without this it is a toy
- Split/tile panes with drag-to-resize — missing this is a reason to leave
- Panel close and add-new-terminal — expected in any multi-terminal product
- cwd set to project folder on panel spawn — users expect this, will `cd` immediately without it
- Copy/paste, scrollback, ANSI/24-bit color, Unicode — all assumed present
- PTY resize on panel resize — vim/htop/less break visibly without SIGWINCH propagation
- Editable session title per panel — required for panel identification in multi-pane setups

**Should have (competitive differentiators — all planned for v1):**

- Output attention detection + pulsing badge — no competitor does proactive prompt detection for local PTY
- Native OS notification when attention needed while app is backgrounded
- Per-panel color dot — spatial orientation in tiling layouts
- Per-project layout and session persistence — automatic, tied to project path; Wave Terminal does manual only
- File tree sidebar — integrated project context no pure terminal has
- Single window, tiles-only model — eliminates the 15-terminal-windows problem

**Defer to v1.x (post-launch polish):**

- Keyboard shortcuts for split/close (Cmd+D)
- Right-click context menu (copy, paste, clear)
- CLI argv project path launch (`multiterm-studio .`)
- Scrollback buffer configuration exposure

**Defer to v2+ (scope protection):**

- SSH / remote sessions — triples scope, contradicts local-first value proposition
- Plugin / extension API — requires stable internal API surface first
- Auto-update mechanism — requires code signing, release server
- Global preferences / settings UI — ship with sensible defaults first
- Session content restoration after reboot — requires PTY daemon architecture

### Architecture Approach

The architecture follows the canonical Electron three-process model with strict process isolation. The main process owns PtyManager (a `Map<id, IPty>` keyed by panel UUID), FolderService, LayoutPersistence, and AttentionWatcher. The preload script is minimal — one typed function per IPC channel, no raw ipcRenderer exposure. The renderer holds all UI state in a single Zustand store; components never call IPC directly, only store actions do. This creates a clean unidirectional flow: component dispatches store action → store action calls `window.electronAPI` → IPC to main → response updates store → React re-renders.

**Major components:**

1. **PtyManager (main)** — owns `Map<string, IPty>`; handles pty:create, pty:write, pty:resize, pty:kill; pipes output to renderer via `webContents.send`; runs AttentionWatcher inline on each data chunk
2. **FolderService (main)** — native open-directory dialog; shallow fs.readdir with lazy-load on expand
3. **LayoutPersistence (main)** — reads/writes `<projectRoot>/.multiterm/layout.json`; called by layout:load and layout:save IPC handlers; write is debounced ~500ms
4. **Preload script** — sole bridge between renderer and main; exposes `window.electronAPI` with typed wrappers for all 8 IPC channels; returns unsubscribe closures for push listeners
5. **Zustand Panel Store (renderer)** — `mosaicTree`, `panels: Map<id, PanelMeta>`, `projectRoot`; store actions are the only IPC call sites
6. **MosaicCanvas (renderer)** — react-mosaic controlled component; onChange → store.setMosaicTree
7. **TermPanel (renderer)** — xterm.js Terminal instance in a React ref; FitAddon + ResizeObserver for resize roundtrip; disposes on unmount
8. **PanelHeader (renderer)** — editable title, color dot picker, attention badge, close button; pure Zustand reads/writes
9. **FileTree (renderer)** — lazy-loading directory tree; calls folder.readdir IPC

**Key architectural constraint:** The `TermPanel` xterm.js instance must be created and `open()`-called inside `useEffect` with a non-null containerRef — never during render. Cleanup must call `terminal.dispose()`.

### Critical Pitfalls

Research identified 9 critical pitfalls. The 5 most impactful, with prevention:

1. **node-pty not externalized from Vite bundle** — Add `rollupOptions.external: ['node-pty']` to `electron.vite.config.ts` main build config before writing any PTY code; keep node-pty in `dependencies` not `devDependencies`. App works in dev, silently fails in production builds without this.

2. **node-pty ABI mismatch with Electron** — Add `"postinstall": "electron-builder install-app-deps"` to package.json scripts. Run after every `npm install` that touches native deps. The runtime error (`compiled against a different Node.js version`) is unambiguous but easy to prevent entirely.

3. **IPC listener accumulation (memory leak)** — Expose unsubscribe closures from contextBridge push listeners; call them in useEffect cleanup. The proxied function identity problem means `ipcRenderer.removeListener` with the same callback reference does NOT work through the bridge — capture the handler inside preload scope. Must be established from the first listener — retrofitting is error-prone.

4. **FitAddon / PTY size mismatch causes garbled output** — Always pair `fitAddon.fit()` with `pty.resize(cols, rows)` IPC in a ResizeObserver callback on the panel container div. Never use `window.resize` — it fires before react-mosaic has finished recalculating tile dimensions.

5. **macOS PATH truncation in packaged app** — Install `fix-path` and call `fixPath()` in `app.whenReady()` before any shell spawn. Apps launched from Finder/Dock get a minimal OS PATH; Homebrew, NVM, and other user tools are invisible in terminal panels without this fix.

---

## Implications for Roadmap

The architecture research explicitly provides a build order based on component dependency analysis. The pitfalls research provides per-phase prevention requirements. Combined, these produce a natural 5-phase structure:

### Phase 1: Electron Scaffold + IPC Foundation + PTY Core

**Rationale:** The contextBridge contract, TypeScript shared types, and PTY plumbing are the foundation everything else imports from. Three of the five critical pitfalls (Vite externalization, ABI mismatch, IPC listener pattern) must be addressed here. Nothing else can be validated until a real shell session works end-to-end.

**Delivers:** Working single-panel terminal — shell spawns in project cwd, keystrokes reach the PTY, output renders in xterm.js, resize roundtrip works.

**Features addressed:** Real PTY shell session, terminal resize on panel resize, folder open (as project path source), keyboard passthrough, ANSI color, scrollback.

**Pitfalls to prevent:** node-pty Vite externalization, ABI mismatch (postinstall script), IPC unsubscribe pattern, macOS PATH (fix-path), xterm.js open() in useEffect lifecycle, PTY cleanup on close (before-quit handler).

**Research flag:** Standard patterns — Electron IPC and node-pty integration are exhaustively documented. No additional research phase needed.

---

### Phase 2: Multi-Panel Tiling Layout + Panel Lifecycle

**Rationale:** react-mosaic requires the PTY-per-panel model to be working before meaningful multi-panel testing. The controlled-component mosaic tree + Zustand store integration is the core architectural coupling. Panel close/add lifecycle must handle PTY cleanup to avoid zombie processes.

**Delivers:** Tiling canvas with N panels; add/remove/split/resize panels; each panel has its own PTY; zombie processes are prevented on close.

**Features addressed:** Split/tile panes, drag-to-resize, panel close, add new terminal button, PTY resize on mosaic drag.

**Pitfalls to prevent:** FitAddon / PTY size mismatch (ResizeObserver per panel container, not window.resize), zombie PTY processes (registry + before-quit handler), react-mosaic uncontrolled mode (use controlled mode from the start — uncontrolled breaks persistence).

**Research flag:** Standard patterns — react-mosaic controlled component and ResizeObserver patterns are well-documented.

---

### Phase 3: Panel Header + Project Context Features

**Rationale:** These features operate on Zustand store state with minimal new IPC surface. Panel header (title, color, close) is pure UI. File tree sidebar requires only the folder.readdir IPC channel, which can be added alongside folder.open. These features can largely be built in parallel once the store shape is stable from Phase 2.

**Delivers:** Panel identity system (editable title, color dot, close button); file tree sidebar displaying project directory; project folder opens on launch.

**Features addressed:** Editable session title, per-panel color dot, close button, file tree sidebar, folder open on launch, cwd = project folder.

**Pitfalls to prevent:** Attention detection false positives from color-related UX (separate concern); file paths validated under project root before use.

**Research flag:** Standard patterns — Zustand store mutations and folder IPC are straightforward.

---

### Phase 4: Attention Detection + Notifications + Per-Project Persistence

**Rationale:** AttentionWatcher plugs into PtyManager's onData pipeline — PTY plumbing (Phase 1) must be complete. Per-project persistence requires the panel metadata shape to be stable (Phase 3 complete). Both features are differentiators that should ship in v1 but depend on prior phases.

**Delivers:** Output attention detection with pulsing badge; native OS notification when backgrounded; per-project layout and session title persistence (save on change, restore on open).

**Features addressed:** Output attention detection + pulsing badge, native OS notification on attention, per-project layout persistence (mosaicTree + panel metadata), restore layout on project reopen.

**Pitfalls to prevent:** Attention detection false positives (match multi-character prompts, debounce per panel — not every `?` character); layout save debounce (300–500ms after onChange — not on every mosaic drag event, which would cause excessive disk writes); panel close order (kill PTY → confirm → remove from mosaic, not the reverse).

**Research flag:** Attention detection pattern-matching needs validation — the specific regex patterns for common CLI prompts (`npm init`, `git commit`, interactive installers) should be tested against real-world output samples. Consider a brief spike here.

---

### Phase 5: Polish, Cross-Platform Verification + Packaging

**Rationale:** Packaging is last because electron-builder ASAR configuration and Windows binary unpacking cannot be tested until the full feature set is built. This phase also covers v1.x features (keyboard shortcuts, right-click context menu, CLI argv launch) and cross-platform smoke testing.

**Delivers:** Packaged installers for macOS (dmg), Linux (AppImage), Windows (nsis); keyboard shortcuts; right-click context menu; CLI argv project path; empty-state handling for last-panel-closed.

**Features addressed:** Keyboard shortcuts (Cmd+D split, close), right-click context menu, CLI argv launch, empty state CTA, copy-on-selection.

**Pitfalls to prevent:** Windows ASAR unpack for node-pty (`asarUnpack: ["**/node_modules/node-pty/**"]`); macOS PATH verified in Finder-launched packaged app; "looks done but isn't" checklist from PITFALLS.md (PTY cleanup, resize correctness, layout persistence, macOS packaged PATH, Windows ASAR, IPC listener cleanup, attention false positives, scrollback memory).

**Research flag:** Windows packaging and code signing have environment-specific requirements. If Windows distribution is a v1 target, a deeper research spike on electron-builder NSIS + Windows signing certificate is warranted before this phase.

---

### Phase Ordering Rationale

- **Phase 1 must be first:** Three of the five critical pitfalls are infrastructure concerns that corrupt subsequent work if not addressed at the foundation. A broken postinstall or leaking IPC pattern touches every feature.
- **Phase 2 before Phase 3:** react-mosaic requires stable PTY-per-panel lifecycle to test panel splits meaningfully. The store shape must stabilize before building UI that reads from it.
- **Phase 3 before Phase 4:** Panel metadata shape (title, color, attention state) must be final before persistence serializes it. The file tree sidebar IPC channel (folder.readdir) is a prerequisite for FolderService being complete.
- **Phase 4 differentiators in v1:** Research confirms no competitor has proactive attention detection or automatic project-scoped persistence. Both must ship in v1 — they are the product's identity.
- **Phase 5 last:** ASAR packaging issues and Windows binary requirements cannot be verified until the full app is buildable. Do not defer Windows testing to after a macOS release — catching ASAR issues early saves a costly retrofit.

### Research Flags

Phases likely needing a `/gsd:research-phase` deeper dive during planning:

- **Phase 4 (Attention Detection):** The regex patterns for common CLI interactive prompts across npm, git, pip, cargo, and homebrew are not standardized. A brief spike to enumerate and test real-world prompt patterns before implementing AttentionWatcher will prevent false-positive UX issues.
- **Phase 5 (Windows Distribution):** Windows code signing certificate requirements, NSIS installer configuration, and conpty improvements in node-pty 1.2.0-beta (not yet stable) have environment-specific dependencies that benefit from a dedicated research pass before packaging begins.

Phases with standard, well-documented patterns (skip research-phase):

- **Phase 1:** Electron IPC + contextBridge + node-pty integration are exhaustively covered by official Electron docs and the node-pty Electron example.
- **Phase 2:** react-mosaic controlled component pattern and ResizeObserver usage are fully documented.
- **Phase 3:** Zustand store mutations, folder IPC, and basic React component patterns need no additional research.

---

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                                                                                          |
| ------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH       | All package versions verified against npm/GitHub releases as of 2026-03-14; version compatibility matrix fully checked                                                                         |
| Features     | HIGH       | Verified against 5 direct competitors (iTerm2, Warp, Wave Terminal, Tabby, Windows Terminal); community pain points sourced from HN and developer forums                                       |
| Architecture | HIGH       | Electron IPC/contextBridge patterns from official Electron docs; node-pty main-process isolation from official node-pty Electron example; react-mosaic controlled component from stable README |
| Pitfalls     | HIGH       | Each critical pitfall sourced from a real GitHub issue or official documentation; most have confirmed reproduction steps and verified fixes                                                    |

**Overall confidence:** HIGH

### Gaps to Address

- **Attention detection regex corpus:** The specific output patterns to match for common interactive CLI tools (npm init, git commit -a, pip install, cargo publish, interactive package managers) are not documented in one place. Build a test corpus of real tool output before implementing AttentionWatcher to avoid false positives.

- **node-pty 1.2.0-beta promotion:** node-pty 1.2.0-beta.12 includes conpty improvements for Windows 10 1809+. Monitor the GitHub releases page before committing to a Windows release date — if it reaches stable before Phase 5, upgrading then is lower risk than shipping 1.1.0 on Windows.

- **react-mosaic maintenance risk:** The library has a low maintenance cadence (last publish ~1 year ago). It is functionally complete for the v1 use case, but if a critical React 19 incompatibility or security issue emerges, the fallback is rebuilding tiling with CSS Grid + ResizeObserver. Track the GitHub issues page during development; this is a known accepted risk, not a blocker.

- **Multi-panel performance ceiling:** Research suggests 5–12 panels begins to stress scrollback memory and xterm.js DOM rendering. The lazy-render mitigation (unmount xterm.js for off-screen tiles while keeping PTY alive) is documented but adds complexity. Validate actual memory usage at 4–6 panels during Phase 2 before deciding whether this optimization belongs in v1.

---

## Sources

### Primary (HIGH confidence)

- https://www.electronjs.org/docs/latest/tutorial/ipc — Electron IPC patterns
- https://www.electronjs.org/docs/latest/tutorial/context-isolation — contextBridge security model
- https://github.com/xtermjs/xterm.js/releases — xterm.js v6 release notes, @xterm scope migration
- https://www.npmjs.com/package/node-pty — node-pty 1.1.0 stable, 1.2.0-beta.12 pre-release
- https://electron-vite.org/guide/ — electron-vite 5.0 features, Node.js version requirements
- https://github.com/nomcopter/react-mosaic — react-mosaic-component 6.1.1, controlled component API
- https://github.com/pmndrs/zustand/releases — zustand 5.0.11
- https://releases.electronjs.org/ — Electron 41.0.2 as latest stable
- https://github.com/electron-userland/electron-builder/releases — electron-builder 26.8.1

### Secondary (MEDIUM confidence)

- https://github.com/microsoft/node-pty/issues/422 — Electron + node-pty integration guide
- https://github.com/microsoft/node-pty/issues/372 — ASAR / winpty.dll compatibility
- https://github.com/xtermjs/xterm.js/issues/4841 — FitAddon resize issues confirmed
- https://github.com/electron/electron/issues/27039 — Memory leak passing IPC events over contextBridge
- https://www.npmjs.com/package/fix-path — macOS PATH fix for packaged apps
- https://iterm2.com/features.html, https://www.warp.dev/all-features, https://github.com/wavetermdev/waveterm, https://github.com/Eugeny/tabby — competitor feature analysis

### Tertiary (for validation during implementation)

- https://brunoscheufler.com/blog/2023-10-29-syncing-state-between-electron-contexts — Zustand + Electron state sync patterns
- https://scopir.com/posts/best-terminal-emulators-developers-2026/ — competitive landscape as of 2026

---

_Research completed: 2026-03-14_
_Ready for roadmap: yes_
