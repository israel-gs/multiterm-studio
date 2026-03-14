---
phase: 01-foundation-terminal-core
plan: 02
subsystem: infra
tags: [node-pty, electron, ipc, ipcMain, pty, shell, vitest, mocking]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Electron scaffold with stub registerPtyHandlers, contextBridge IPC bridge, and ptyManager.test.ts todo stubs"
provides:
  - "PTY session lifecycle management via Map<string, PtySession>"
  - "ipcMain.handle for pty:create, pty:write, pty:resize, pty:kill"
  - "pty:create spawns user's SHELL with xterm-256color and provided cwd"
  - "pty:create registers onData pushing data to renderer via webContents.send(pty:data:{id})"
  - "Defensive null-checks on all handlers for unknown session ids"
  - "Unit tests: 11 passing tests covering all IPC handler behaviors"
affects: [01-03-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IPC handler unit testing: vi.mock('electron') captures ipcMain.handle calls into capturedHandlers dict; handlers invoked directly in tests"
    - "node-pty mock: vi.mock('node-pty') with { default: { spawn }, spawn } to handle both named and default import shapes"
    - "Sessions Map pattern: Map<string, { process: IPty }> keyed by renderer-supplied id for O(1) lookup and clean lifecycle"
    - "Shell detection: process.env.SHELL || (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')"

key-files:
  created: []
  modified:
    - "src/main/ptyManager.ts — full implementation: sessions Map, registerPtyHandlers with 4 ipcMain.handle calls"
    - "tests/main/ptyManager.test.ts — 11 passing tests replacing 6 todo stubs; mocks electron and node-pty"

key-decisions:
  - "Used vi.clearAllMocks() in beforeEach (clears call history, preserves implementations) — allows shared mockIpcMain.handle to capture handlers across tests without module cache invalidation"
  - "IPC handler returns void (not Promise) for no-op early-returns — test assertions use expect().not.toThrow() not .resolves; handlers that do work are also synchronous except onData callback"
  - "Sessions Map is module-level (not per-call) — persists across handler invocations as designed, one shared registry per main process lifetime"

patterns-established:
  - "capturedHandlers dict pattern: store ipcMain.handle second argument by channel name; invoke in tests to simulate IPC calls without Electron runtime"

requirements-completed: [INFRA-03, TERM-01, TERM-02]

# Metrics
duration: 3min
completed: 2026-03-14
---

# Phase 1 Plan 02: PTY Manager — IPC handlers with node-pty session lifecycle and unit tests

**node-pty session manager with Map-based lifecycle, 4 ipcMain handlers (create/write/resize/kill), onData push to renderer via webContents.send, and 11 unit tests using vi.mock for electron and node-pty**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-14T06:43:58Z
- **Completed:** 2026-03-14T06:47:07Z
- **Tasks:** 1 (TDD: RED commit + GREEN commit)
- **Files modified:** 2

## Accomplishments

- ptyManager.ts fully implemented: sessions Map, registerPtyHandlers registers all 4 ipcMain handlers
- pty:create spawns user shell with xterm-256color TERM, provided cwd, and full process.env
- pty:create registers onData that pushes terminal output to renderer via webContents.send(`pty:data:${id}`)
- All 4 handlers defensive against unknown session ids (no crash, silent no-op)
- pty:kill correctly calls process.kill() AND removes session from Map (no memory leak)
- 22/22 total tests pass (11 new ptyManager + 11 existing); node-pty absent from renderer and preload

## Task Commits

TDD task with two commits:

1. **RED: failing tests for PTY manager** - `6e52753` (test)
2. **GREEN: implement PTY manager + fix test assertions** - `ec5fe2b` (feat)

**Plan metadata:** (docs commit to follow)

_Note: TDD task — RED commit (failing tests) + GREEN commit (implementation + test assertion fix)_

## Files Created/Modified

- `src/main/ptyManager.ts` — Full implementation: sessions Map, registerPtyHandlers with 4 ipcMain.handle registrations, shell detection, onData push, defensive null checks
- `tests/main/ptyManager.test.ts` — 11 real tests replacing 6 todo stubs; mocks electron (ipcMain) and node-pty (spawn + IPty methods)

## Decisions Made

- `vi.clearAllMocks()` in `beforeEach` (not `resetAllMocks`) — preserves mock implementations (the handler-capture closure) while clearing call history between tests
- IPC handlers return `void` synchronously for early-return paths — tests use `expect().not.toThrow()` not `.resolves.not.toThrow()` which requires a Promise
- Module-level sessions Map (not per-call) — correct design; single registry across all IPC invocations in the main process lifetime

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `.resolves.not.toThrow()` on void-returning handlers**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test used `.resolves.not.toThrow()` for handlers returning void (synchronous early-return) — Vitest requires a Promise for `.resolves`
- **Fix:** Changed to `expect(() => capturedHandlers[channel](...)).not.toThrow()` for unknown-id defensive tests
- **Files modified:** tests/main/ptyManager.test.ts
- **Verification:** All 11 tests pass
- **Committed in:** ec5fe2b (GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - test assertion bug)
**Impact on plan:** Test-only fix; implementation unchanged. No scope creep.

## Issues Encountered

None — ptyManager implementation passed tests on first implementation attempt. One test assertion fix needed for void-vs-Promise handling in Vitest.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 03 (Terminal UI) can proceed immediately: `window.electronAPI.ptyCreate/ptyWrite/ptyResize/ptyKill/onPtyData` IPC bridge is fully functional end-to-end
- IPC channels are live: renderer calls ptyCreate → ptyManager spawns shell → onData fires → webContents.send pushes to renderer → preload's onPtyData callback fires
- xterm.js terminal component in Plan 03 can connect directly to these IPC channels

## Self-Check: PASSED

All created files verified present on disk. Both task commits (6e52753, ec5fe2b) verified in git history.

---
*Phase: 01-foundation-terminal-core*
*Completed: 2026-03-14*
