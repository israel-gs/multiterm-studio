# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Core value:** Terminals that are project-aware: every panel inherits the project's working directory, layout and sessions persist per-project, and an output watcher alerts you when a long-running process needs attention.
**Current focus:** Phase 1 — Foundation + Terminal Core

## Current Position

Phase: 1 of 4 (Foundation + Terminal Core)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-03-14 — Plan 01-02 complete: PTY manager IPC handlers, node-pty session lifecycle, 22 tests green

Progress: [██░░░░░░░░] 17%

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: 4 min
- Total execution time: 0.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 1 | 2 of 3 | 8 min | 4 min |

**Recent Trend:**
- Last 5 plans: 01-01 (5 min), 01-02 (3 min)
- Trend: stable

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-Phase 1]: Use `@xterm/*` scoped packages (v6) only — unscoped `xterm` packages are deprecated and frozen
- [Pre-Phase 1]: node-pty must be in `dependencies` (not devDependencies) and externalized from Vite bundle via `rollupOptions.external`
- [Pre-Phase 1]: IPC push listeners must expose unsubscribe closures from contextBridge — removeListener does not work through the bridge
- [01-01]: Used `rollupOptions.external` (not deprecated `externalizeDepsPlugin`) to externalize node-pty from electron-vite 5.0
- [01-01]: Static file verification tests (read source as text) chosen over Electron mocking for window.test.ts — avoids complex BrowserWindow mock setup
- [01-01]: node-pty placed in `dependencies` (not devDependencies) — electron-builder only rebuilds native modules in `dependencies` for production builds
- [01-02]: IPC handlers return void (not Promise) for early-return no-op paths — test assertions use expect().not.toThrow(), not .resolves
- [01-02]: capturedHandlers dict pattern for unit testing ipcMain.handle — mock captures handler function by channel, tests invoke directly without Electron runtime

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1 RESOLVED]: node-pty ABI mismatch — resolved via postinstall script, rebuilt successfully for Electron 39.x arm64
- [Phase 4]: Attention detection regex corpus needs validation against real-world CLI tool output (npm init, git commit, pip, cargo) before implementation — false positives degrade UX
- [Phase 4]: node-pty 1.2.0-beta.12 has conpty improvements for Windows; monitor before committing to Windows release target

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 01-02-PLAN.md — PTY manager IPC handlers, node-pty session lifecycle, 22 tests green
Resume file: None
