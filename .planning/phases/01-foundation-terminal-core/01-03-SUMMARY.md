---
phase: 01-foundation-terminal-core
plan: '03'
subsystem: ui
tags: [xterm, xterm-js, electron, pty, terminal, react, fit-addon, web-links-addon, resize-observer]

# Dependency graph
requires:
  - phase: 01-01
    provides: IPC bridge (window.electronAPI), CSS custom properties, Electron scaffold
  - phase: 01-02
    provides: PTY manager IPC handlers (ptyCreate, ptyWrite, ptyResize, ptyKill, onPtyData)
provides:
  - xterm.js Terminal component with FitAddon, WebLinksAddon, and ResizeObserver resize roundtrip
  - App.tsx rendering a full-viewport TerminalPanel with stable sessionId
  - 11 unit tests for Terminal component setup and lifecycle
  - Complete Phase 1 terminal experience: real PTY, ANSI colors, keyboard, scrollback, URL clicks, copy/paste, resize
affects:
  - Phase 2 (multi-panel layout will wrap TerminalPanel in a split-pane shell)
  - Phase 3 (project-aware cwd will replace the static '.' prop)
  - Phase 4 (attention detection hooks into the onPtyData stream)

# Tech tracking
tech-stack:
  added:
    - '@xterm/xterm ^5.x'
    - '@xterm/addon-fit'
    - '@xterm/addon-web-links'
  patterns:
    - 'TDD RED→GREEN: test file committed separately before implementation'
    - 'vi.hoisted() for vi.mock hoisting when constructor reference needed in mock factory'
    - 'ResizeObserver → fitAddon.fit() → ptyResize IPC roundtrip for live terminal resize'
    - 'useRef for stable sessionId across React re-renders (avoids PTY re-creation)'

key-files:
  created:
    - src/renderer/src/components/Terminal.tsx
    - tests/renderer/Terminal.test.tsx
  modified:
    - src/renderer/src/App.tsx

key-decisions:
  - 'Import @xterm/xterm/css/xterm.css inside Terminal.tsx (required for visible rendering — terminal is invisible without it)'
  - 'Used vi.hoisted() to lift the mockFitAddon variable above the vi.mock() call — standard vi.mock hoisting breaks named constructor references'
  - 'sessionId generated via crypto.randomUUID() wrapped in useRef to remain stable across re-renders'
  - "cwd passed as '.' from renderer; ptyManager.ts resolves it to process.cwd() via path.resolve — main process is authoritative over paths"

patterns-established:
  - 'Terminal lifecycle: create → loadAddon → open → fit → ptyCreate → wire onData/onPtyData → ResizeObserver; cleanup in reverse'
  - 'IPC unsubscribe pattern: onPtyData returns a cleanup closure; stored in const and called in useEffect cleanup'

requirements-completed:
  - TERM-03
  - TERM-04
  - TERM-05
  - TERM-06
  - TERM-07
  - TERM-08
  - TERM-09

# Metrics
duration: ~10min
completed: 2026-03-14
---

# Phase 1 Plan 03: Terminal Component Summary

**xterm.js terminal panel with FitAddon, WebLinksAddon, and ResizeObserver resize roundtrip — full Phase 1 interactive terminal experience verified by human tester**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-14T01:50:00Z
- **Completed:** 2026-03-14T06:59:12Z
- **Tasks:** 2 (1 auto TDD, 1 human-verify checkpoint — approved)
- **Files modified:** 3

## Accomplishments

- Terminal.tsx component with full xterm.js setup: scrollback 10000, 16-color dark theme, cursorBlink, FitAddon, WebLinksAddon, convertEol:false
- ResizeObserver triggers fitAddon.fit() then ptyResize IPC roundtrip on every container size change
- App.tsx renders full-viewport TerminalPanel with stable useRef sessionId and cwd='.'
- 11 unit tests covering component setup, addon loading, PTY wiring, and cleanup lifecycle
- All 33 tests pass (11 Terminal + 11 ptyManager + 7 theme + 4 window)
- Human verification confirmed: real PTY shell, ANSI 256/24-bit colors, Ctrl+C, arrow keys, tab completion, clickable URLs, copy/paste, window resize, 10000-line scrollback

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Terminal component (TDD RED)** - `eb2c6b7` (test)
2. **Task 1: Create Terminal component (TDD GREEN)** - `e1de166` (feat)

_Note: TDD tasks have two commits — failing tests first (RED), then implementation (GREEN)._

## Files Created/Modified

- `src/renderer/src/components/Terminal.tsx` — xterm.js Terminal component with FitAddon, WebLinksAddon, ResizeObserver resize roundtrip, PTY IPC wiring, dark theme
- `src/renderer/src/App.tsx` — Root component updated to render TerminalPanel in full-viewport div with stable sessionId
- `tests/renderer/Terminal.test.tsx` — 11 unit tests for Terminal component: constructor options, addon loading, open/fit order, PTY create/write/read, cleanup lifecycle

## Decisions Made

- Imported `@xterm/xterm/css/xterm.css` directly in Terminal.tsx — terminal renders as blank white without this; it must be co-located with the component
- Used `vi.hoisted()` to declare `mockFitAddon` before the `vi.mock()` factory executes — standard variable declarations inside mock factories are silently undefined due to Vitest's hoisting behavior
- `sessionId` uses `useRef(crypto.randomUUID())` rather than `useState` — avoids re-creating the PTY session on unrelated re-renders
- `cwd` is passed as `'.'` from the renderer and resolved to absolute path in `ptyManager.ts` via `path.resolve(cwd)` — main process is authoritative over filesystem paths

## Deviations from Plan

None — plan executed exactly as written. The `vi.hoisted()` fix was an implementation detail discovered during test authoring (not a deviation from plan intent).

## Issues Encountered

- **vi.mock hoisting with named constructor reference:** When the `vi.mock('@xterm/addon-fit', ...)` factory referenced a `mockFitAddon` variable, Vitest's hoisting moved the mock call above the variable declaration, causing `mockFitAddon` to be `undefined` inside the factory. Fixed by wrapping the declaration in `vi.hoisted(() => ...)`, which runs before mock factories.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 1 complete: all three plans done, full terminal core delivered
- Terminal component is ready to receive a sessionId prop from a multi-panel layout manager (Phase 2)
- The `cwd` prop accepts any directory string; Phase 3 will inject the project's working directory here
- PTY data stream is accessible via onPtyData — Phase 4 attention detection can attach a listener here without modifying Terminal.tsx

---

_Phase: 01-foundation-terminal-core_
_Completed: 2026-03-14_
