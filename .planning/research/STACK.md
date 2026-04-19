# Stack Research

**Domain:** Cross-platform desktop terminal multiplexer (Electron + React)
**Researched:** 2026-03-14
**Confidence:** HIGH (all versions verified against npm/GitHub releases as of research date)

---

## Recommended Stack

### Core Technologies

| Technology    | Version                           | Purpose                                               | Why Recommended                                                                                                                                                                                                             |
| ------------- | --------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron      | 41.x (latest stable)              | Desktop shell, OS integration, native APIs            | Active LTS as of March 2026; ships Node 24.x, Chromium 130+. Constrained by PROJECT.md to 28+, but 41 is the correct target — it is what users will receive from electron-builder.                                          |
| React         | 18.x                              | Component tree, rendering                             | React 18 concurrent mode with fine-grained re-render control via zustand selectors is the right fit. React 19 exists but react-mosaic-component v6.1.1 peer deps only explicitly support 18/19 — no reason to chase 19 yet. |
| TypeScript    | 5.x (latest ~5.7)                 | Type safety across main + renderer                    | Strict mode enforced via `tsconfig.json`. Use `moduleResolution: "bundler"` to align with Vite's resolution. Separate tsconfigs for main, preload, and renderer to scope lib targets correctly.                             |
| electron-vite | 5.x (5.0, Dec 2025)               | Unified build tooling for all three Electron contexts | Replaces three separate Vite configs with one opinionated config. Handles main/preload/renderer bundling, HMR, and source maps. Requires Node 20.19+ or 22.12+. Far less config than manual Vite + electron-builder wiring. |
| Vite          | 6.x (peer dep of electron-vite 5) | Renderer bundler                                      | electron-vite 5 upgrades its internal Vite peer to v5+; Vite 6 is compatible. Do not configure Vite directly — go through electron-vite's config API.                                                                       |

### PTY and Terminal Rendering

| Technology             | Version        | Purpose                            | Why Recommended                                                                                                                                                                                                                            |
| ---------------------- | -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| node-pty               | 1.1.0 (stable) | Fork PTY processes in main process | Only library for real PTY in Node.js. Keep in main process — never expose to renderer. 1.2.0-beta.12 is the latest but still pre-release; use 1.1.0 for stability. Requires native rebuild against Electron's ABI via `@electron/rebuild`. |
| @xterm/xterm           | 6.0.0          | Terminal emulator in renderer      | v6 is a complete rewrite of the public API vs v5; 30% smaller bundle (379kb → 265kb). **Do not use the old `xterm` npm package** — it is deprecated since v5.4.0 and unmaintained.                                                         |
| @xterm/addon-fit       | 0.10.x         | Resize terminal to container       | Required to keep xterm dimensions in sync with panel container bounds. Load after terminal attach; call `fit()` in ResizeObserver callback.                                                                                                |
| @xterm/addon-web-links | 0.11.x         | Clickable URLs in terminal output  | Passive UX improvement at near-zero cost. Load on terminal init.                                                                                                                                                                           |
| @xterm/addon-webgl     | 0.18.x         | GPU-accelerated rendering          | Significant perf improvement over DOM renderer in multi-panel setups; falls back gracefully if WebGL unavailable. Use over DOM renderer for production.                                                                                    |

### Layout and State

| Technology             | Version      | Purpose                | Why Recommended                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| react-mosaic-component | 6.1.1        | Tiling window manager  | The only battle-tested React tiling library with binary-tree layout state, full drag-and-drop, TypeScript-first, and a stable imperative API for split/close operations. v6.1.1 adds React 18/19 peer dep support. **Low maintenance cadence** (last publish ~1 year ago), but the API is stable and there is no competitive alternative without rebuilding from scratch. |
| zustand                | 5.x (5.0.11) | Panel state management | 1KB runtime, no context provider boilerplate, subscription-based selectors prevent unnecessary re-renders across many panels. Slice pattern scales cleanly — one slice for panels, one for layout, one for project config. Better fit than Jotai for this use case because panel state is inherently global/interconnected rather than atomic/independent.                |

### Packaging and Distribution

| Technology        | Version | Purpose                                       | Why Recommended                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| electron-builder  | 26.8.1  | Cross-platform packaging                      | Handles macOS (dmg/pkg), Windows (nsis), Linux (AppImage/deb). ~1.1M weekly downloads vs electron-forge's ~2K. Integrates directly with electron-vite's build output. electron-forge is better for teams that want official Electron tooling with guided workflows, but electron-builder has superior cross-platform support from a single machine — important for open source release. |
| @electron/rebuild | latest  | Rebuild native modules against Electron's ABI | Required post-`npm install` to recompile node-pty. Add as a `postinstall` script. This replaces the old `electron-rebuild` package name.                                                                                                                                                                                                                                                |

### Supporting Libraries

| Library      | Version | Purpose                   | When to Use                                                                                                                                                                                                                     |
| ------------ | ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| immer        | 10.x    | Immutable state updates   | Use inside zustand's `set()` calls when mutating nested panel tree state; avoids spread-heavy reducers.                                                                                                                         |
| @types/node  | 20.x    | Node.js type definitions  | Needed in main process tsconfig. Do NOT include in renderer tsconfig — renderer has no Node access by design.                                                                                                                   |
| concurrently | latest  | Dev command orchestration | Run Electron watcher + Vite dev server simultaneously during development if not using electron-vite's built-in `dev` command. electron-vite's `npm run dev` handles this natively — only needed if deviating from the scaffold. |

### Development Tools

| Tool                            | Purpose                       | Notes                                                                                                                                                     |
| ------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| electron-vite CLI               | Unified dev/build entry point | `npm run dev` starts all processes. `npm run build` produces production assets. `npm run preview` opens packaged build.                                   |
| ESLint + typescript-eslint      | Code quality                  | Use `@typescript-eslint/recommended-type-checked` ruleset for type-aware linting. Requires `parserOptions.project` pointing to tsconfig.                  |
| Prettier                        | Code formatting               | Integrate as ESLint plugin (`eslint-plugin-prettier`) to keep tooling unified.                                                                            |
| @electron/rebuild (postinstall) | Native module ABI alignment   | Add `"postinstall": "electron-rebuild"` to package.json scripts. Prevents silent runtime failures from ABI mismatch after `npm install` on a new machine. |

---

## Installation

```bash
# Scaffold with electron-vite (React + TypeScript template)
npm create @quick-start/electron@latest multiterm-studio -- --template react-ts

# Terminal rendering (use @xterm scoped packages — old xterm/* is deprecated)
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-webgl

# PTY (main process only)
npm install node-pty

# Layout and state
npm install react-mosaic-component zustand immer

# Dev dependencies
npm install -D @electron/rebuild @types/node eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser prettier eslint-plugin-prettier
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "postinstall": "electron-rebuild"
  }
}
```

---

## Alternatives Considered

| Recommended                  | Alternative                                        | When to Use Alternative                                                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| electron-vite 5              | Manual Vite + electron-builder config              | Only if you need extreme control over each bundler context independently; not worth the maintenance cost for a standard app.                                                                                           |
| electron-builder             | electron-forge                                     | If you're building something deeply integrated with the Electron project's official tooling, want a first-party publish workflow, and all your CI targets a single OS.                                                 |
| @xterm/xterm v6              | @xterm/xterm v5.x                                  | If you depend on a third-party library that hasn't migrated to the `@xterm` scope yet (rare). v5.x still works but receives no security updates.                                                                       |
| node-pty 1.1.0 (stable)      | node-pty 1.2.0-beta                                | When the beta reaches stable and confirms no ABI regression against latest Electron. Track the GitHub releases page for promotion.                                                                                     |
| react-mosaic-component       | Build custom tiling with CSS Grid + ResizeObserver | If react-mosaic's binary-tree constraint feels limiting (e.g., you need non-binary splits or tabs). Engineering cost is high — only justified if the layout model must diverge significantly.                          |
| zustand                      | jotai                                              | If panel state decomposed into many independent atoms where automatic re-render isolation per-atom matters more than centralized state. For this app's panel-centric model, zustand's global store slices are cleaner. |
| CSS Modules (via PROJECT.md) | styled-components / Emotion                        | Runtime CSS-in-JS adds bundle weight and a runtime cost that matters in a terminal app doing constant DOM updates. CSS modules have zero runtime overhead.                                                             |

---

## What NOT to Use

| Avoid                                                           | Why                                                                                                                                                         | Use Instead                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `xterm` (unscoped npm package)                                  | Deprecated since v5.4.0, no longer receives security updates or API changes. Resolves to stale v5.3.x.                                                      | `@xterm/xterm` v6                                                            |
| `xterm-addon-fit`, `xterm-addon-web-links`, `xterm-addon-webgl` | Same deprecation — the unscoped addon packages are frozen.                                                                                                  | `@xterm/addon-fit`, `@xterm/addon-web-links`, `@xterm/addon-webgl`           |
| `electron-rebuild` (unscoped)                                   | The package was renamed to `@electron/rebuild`. Old package is unmaintained.                                                                                | `@electron/rebuild`                                                          |
| `nodeIntegration: true`                                         | Exposes full Node.js API to renderer — critical security vulnerability. All real terminal apps have been exploited through this path.                       | `contextIsolation: true` + `contextBridge` + `ipcRenderer.invoke` in preload |
| Redux / Redux Toolkit                                           | Far too much boilerplate for panel state that maps naturally to zustand slices. Redux's reducer indirection adds no value here.                             | zustand                                                                      |
| webpack (via `electron-webpack`)                                | Slow builds, complex config, poor HMR story. The Electron ecosystem has broadly moved to Vite-based tooling.                                                | electron-vite                                                                |
| Canvas addon (`@xterm/addon-canvas`)                            | Removed entirely in v6. Code targeting this addon will fail at runtime.                                                                                     | `@xterm/addon-webgl` (GPU) or DOM renderer fallback                          |
| Electron versions below 28                                      | `contextIsolation` is enabled by default since v12 but the project constraint is 28+. Older versions lack security patches and API surface used by the app. | Electron 41.x                                                                |

---

## Stack Patterns by Variant

**If packaging for macOS only (initial release):**

- electron-builder still recommended; output `dmg` target
- No need for Windows-specific PTY handling (`conpty` flag in node-pty)

**If adding Windows support:**

- node-pty 1.2.0 beta series includes conpty improvements for Windows 10 1809+; track for promotion to stable before Windows release
- electron-builder's NSIS target handles code signing setup separately — plan for a Windows signing certificate before distribution

**If Linux CI packaging (no display):**

- electron-builder's AppImage target works headless
- xterm.js WebGL renderer requires a display — test DOM renderer fallback in CI

---

## Version Compatibility

| Package                      | Compatible With                          | Notes                                                                  |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| electron 41.x                | node-pty 1.1.0 (after rebuild)           | Native ABI must match; run `@electron/rebuild` after install           |
| electron 41.x                | @xterm/xterm 6.0.0                       | Pure JS, no native module — no rebuild needed                          |
| electron-vite 5.x            | Vite 5+ / 6                              | electron-vite 5 upgraded internal peer to Vite 5+; Vite 6 compatible   |
| electron-vite 5.x            | Node.js 20.19+ or 22.12+                 | Hard requirement; Node 18 will fail                                    |
| react-mosaic-component 6.1.1 | React 18.x and 19.x                      | Peer deps explicitly list both; safe with React 18                     |
| zustand 5.x                  | React 18.x                               | zustand 5 dropped support for React < 18; no issue here                |
| @xterm/xterm 6.x             | @xterm/addon-fit, @xterm/addon-web-links | All addons must be from the `@xterm` scope and match the major version |

---

## Security Notes

The security model is non-negotiable for a terminal app exposing PTY:

1. **`contextIsolation: true`** — mandatory; prevents renderer from reaching Node.js directly
2. **`nodeIntegration: false`** — mandatory; renderer is a browser context only
3. **`sandbox: false`** for the renderer window that uses `node-pty` via IPC — electron-vite's preload script bridge handles this
4. **contextBridge** — expose only the specific IPC channels listed in PROJECT.md (`pty:create`, `pty:write`, `pty:resize`, `pty:kill`, `pty:data`, `pty:attention`, `folder:open`, `folder:readdir`). Never expose `ipcRenderer` itself.
5. **Validate IPC sender** — in main process handlers, validate `event.senderFrame.url` or `event.sender.id` to prevent rogue renderers from calling PTY channels

---

## Sources

- https://releases.electronjs.org/ — Electron 41.0.2 as latest stable (March 2026)
- https://github.com/xtermjs/xterm.js/releases — xterm.js 6.0.0 release notes, @xterm scope migration, addon package names
- https://www.npmjs.com/package/node-pty — node-pty 1.1.0 stable, 1.2.0-beta.12 pre-release
- https://electron-vite.org/blog/ — electron-vite 5.0 features and deprecations
- https://electron-vite.org/guide/ — Node.js version requirements (20.19+ / 22.12+)
- https://github.com/nomcopter/react-mosaic — react-mosaic-component 6.1.1, React 18/19 peer deps, maintenance cadence
- https://github.com/pmndrs/zustand/releases — zustand 5.0.11
- https://github.com/electron-userland/electron-builder/releases — electron-builder 26.8.1
- https://github.com/electron/rebuild — @electron/rebuild (replacement for electron-rebuild)
- https://www.electronjs.org/docs/latest/tutorial/context-isolation — contextBridge best practices
- https://npmtrends.com/electron-builder-vs-electron-forge — download comparison for packaging tools

---

_Stack research for: Electron multi-terminal desktop app (multiterm-studio)_
_Researched: 2026-03-14_
