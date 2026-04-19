---
phase: 01-foundation-terminal-core
plan: 01
subsystem: infra
tags: [electron, electron-vite, react, typescript, node-pty, xterm, vitest, contextBridge, ipc]

# Dependency graph
requires: []
provides:
  - 'Electron app scaffolded with electron-vite react-ts template'
  - 'BrowserWindow with contextIsolation:true, nodeIntegration:false, sandbox:false'
  - 'contextBridge API exposing ptyCreate, ptyWrite, ptyResize, ptyKill, onPtyData'
  - 'onPtyData unsubscribe closure pattern (electron#33328 workaround)'
  - 'node-pty externalized in rollupOptions for main and preload'
  - 'postinstall script rebuilds native modules via electron-builder install-app-deps'
  - 'Dark theme CSS variables (#1a1a1a, #242424, #2e2e2e) on :root'
  - 'Vitest test infrastructure with jsdom environment'
  - 'Wave 0 test scaffolds: window.test.ts, ptyManager.test.ts, theme.test.ts'
affects: [01-02-PLAN.md, 01-03-PLAN.md, all-renderer-plans]

# Tech tracking
tech-stack:
  added:
    - 'electron ^39.2.6'
    - 'electron-vite ^5.0.0'
    - 'react ^19.2.1 + typescript ^5.9.3'
    - 'node-pty ^1.1.0 (in dependencies, rebuilt for Electron ABI)'
    - '@xterm/xterm ^6.0.0, @xterm/addon-fit ^0.11.0, @xterm/addon-web-links ^0.12.0'
    - 'electron-builder ^26.0.12 (postinstall native rebuild)'
    - 'vitest ^3.0.0, @testing-library/react ^16, jsdom ^26'
  patterns:
    - 'contextBridge push-listener unsubscribe closure (capture listener ref in function scope, return () => removeListener)'
    - 'rollupOptions.external for native modules in electron-vite (not externalizeDepsPlugin)'
    - 'Static file verification tests (read source as text, assert patterns) for Electron-mocked code'
    - 'test.todo() for stub tests awaiting Plan 02 implementation'

key-files:
  created:
    - 'src/main/index.ts — BrowserWindow with secure webPreferences, imports registerPtyHandlers'
    - 'src/main/ptyManager.ts — stub registerPtyHandlers (no-op, implemented in Plan 02)'
    - 'src/preload/index.ts — contextBridge API with 5 IPC methods and unsubscribe pattern'
    - 'src/preload/index.d.ts — Window.electronAPI type declaration'
    - 'src/renderer/src/env.d.ts — Window interface augmentation for electronAPI'
    - 'src/renderer/src/App.tsx — minimal dark placeholder'
    - 'src/renderer/src/assets/global.css — dark theme CSS custom properties'
    - 'src/renderer/src/main.tsx — imports global.css, renders App'
    - 'electron.vite.config.ts — node-pty externalized in main+preload rollupOptions'
    - 'package.json — production deps + postinstall + test script'
    - 'vitest.config.ts — test config with jsdom, globals, @renderer alias'
    - 'tests/main/window.test.ts — INFRA-01 static verification'
    - 'tests/main/ptyManager.test.ts — INFRA-02/TERM-01/TERM-02 todo stubs'
    - 'tests/renderer/theme.test.ts — INFRA-05 static verification'
  modified: []

key-decisions:
  - 'Used rollupOptions.external (not externalizeDepsPlugin — deprecated in electron-vite 5.0) to externalize node-pty'
  - 'Static file verification tests chosen over Electron mocking — reads source as text, asserts patterns; avoids complexity of mocking BrowserWindow'
  - 'node-pty in dependencies (not devDependencies) — electron-builder only rebuilds modules in dependencies for packaged app'
  - 'postinstall uses electron-builder install-app-deps — rebuilt node-pty successfully for Electron 39.x arm64'
  - 'Removed @electron-toolkit/preload electronAPI exposure in favor of custom contextBridge electronAPI — avoids conflict between bridge namespaces'

patterns-established:
  - 'contextBridge unsubscribe closure: always create listener inside exposed function, return () => removeListener(channel, listener)'
  - 'Dark theme via CSS custom properties on :root — consistent with xterm.js ITheme spec'
  - 'Test stubs via test.todo() — show as pending not failing, unblocks CI while Plan 02 implements'

requirements-completed: [INFRA-01, INFRA-02, INFRA-04, INFRA-05]

# Metrics
duration: 5min
completed: 2026-03-14
---

# Phase 1 Plan 01: Scaffold Electron + electron-vite project with secure IPC bridge, dark theme, and Wave 0 test scaffolds

**electron-vite react-ts scaffold with contextBridge IPC bridge (ptyCreate/ptyWrite/ptyResize/ptyKill/onPtyData), node-pty externalized and rebuilt for Electron ABI, dark theme CSS variables, and vitest Wave 0 test scaffolds covering INFRA-01 and INFRA-05**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-14T06:34:40Z
- **Completed:** 2026-03-14T06:40:01Z
- **Tasks:** 2
- **Files modified:** 14

## Accomplishments

- Electron app scaffolded with electron-vite 5.0 react-ts template; `npm run build` succeeds cleanly
- BrowserWindow configured with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`, `backgroundColor: '#1a1a1a'`
- Full contextBridge API with the unsubscribe closure pattern for `onPtyData` — correctly works around the Electron#33328 removeListener bug
- node-pty in `dependencies`, externalized in Vite, rebuilt for Electron 39.x arm64 ABI via `electron-builder install-app-deps` postinstall
- Dark theme CSS custom properties established (`--bg-main: #1a1a1a`, `--bg-panel: #242424`, `--bg-header: #2e2e2e`)
- Vitest configured; 11 tests green, 6 todo stubs pending for Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Electron project with electron-vite and configure build** - `9bcb0fd` (feat)
2. **Task 2: Create Wave 0 test scaffolds and vitest configuration** - `66bd304` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified

- `src/main/index.ts` — BrowserWindow: 1200x800, backgroundColor #1a1a1a, contextIsolation:true, nodeIntegration:false, sandbox:false; imports ptyManager stub
- `src/main/ptyManager.ts` — stub `registerPtyHandlers(webContents: WebContents): void {}` (no-op)
- `src/preload/index.ts` — contextBridge exposes ptyCreate, ptyWrite, ptyResize, ptyKill, onPtyData with unsubscribe closure
- `src/preload/index.d.ts` — Window.electronAPI type declaration
- `src/renderer/src/env.d.ts` — Window interface augmentation for electronAPI with full type signatures
- `src/renderer/src/App.tsx` — minimal dark placeholder "Multiterm Studio" centered
- `src/renderer/src/assets/global.css` — dark theme CSS custom properties on :root
- `src/renderer/src/main.tsx` — imports global.css, renders App in StrictMode
- `electron.vite.config.ts` — node-pty in rollupOptions.external for main and preload; @vitejs/plugin-react for renderer
- `package.json` — node-pty + @xterm/\* in dependencies; postinstall = electron-builder install-app-deps; test script
- `vitest.config.ts` — globals, jsdom, tests/\*\* include pattern, @renderer alias
- `tests/main/window.test.ts` — 4 passing static tests for INFRA-01 (contextIsolation, nodeIntegration, sandbox, preload path)
- `tests/main/ptyManager.test.ts` — 6 test.todo stubs for INFRA-02, TERM-01, TERM-02
- `tests/renderer/theme.test.ts` — 7 passing static tests for INFRA-05 CSS custom properties

## Decisions Made

- Used `rollupOptions.external` (not deprecated `externalizeDepsPlugin`) to externalize node-pty from Vite bundle
- Chose static file verification tests (read source as text, assert patterns) over mocking Electron — avoids complex mock setup for BrowserWindow
- Replaced scaffold's `@electron-toolkit/preload` electron exposure with custom `electronAPI` contextBridge — keeps IPC namespace clean and project-specific
- node-pty placed in `dependencies` (not devDependencies) — electron-builder only rebuilds native modules in `dependencies` for production builds

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. The `npm create @quick-start/electron@latest` scaffold prompts required piping `yes ""` to accept defaults (non-interactive), then files were copied into the project root. All build and test steps passed on first attempt.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 02 (PTY Manager) can proceed immediately: `src/main/ptyManager.ts` stub is in place, IPC channels are named (`pty:create`, `pty:write`, `pty:resize`, `pty:kill`, `pty:data:{id}`), and `window.electronAPI` types are declared in both preload and renderer
- Plan 03 (Terminal UI) can proceed after Plan 02: `window.electronAPI` types available, dark theme variables defined, renderer entry point ready
- 6 todo stubs in `tests/main/ptyManager.test.ts` will be implemented in Plan 02

## Self-Check: PASSED

All created files verified present on disk. Both task commits (9bcb0fd, 66bd304) verified in git history.

---

_Phase: 01-foundation-terminal-core_
_Completed: 2026-03-14_
