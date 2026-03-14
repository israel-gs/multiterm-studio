---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in-progress
stopped_at: Completed 02-01-PLAN.md — tiling mosaic layout with zustand panel store, PTY lifecycle management
last_updated: "2026-03-14T07:30:14.143Z"
last_activity: "2026-03-14 — Plan 02-01 complete: react-mosaic v7 tiling layout, zustand panelStore, MosaicLayout, PanelWindow, PTY kill on onChange diff"
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 5
  completed_plans: 4
  percent: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Core value:** Terminals that are project-aware: every panel inherits the project's working directory, layout and sessions persist per-project, and an output watcher alerts you when a long-running process needs attention.
**Current focus:** Phase 2 — Multi-Panel Layout

## Current Position

Phase: 2 of 4 (Multi-Panel Layout)
Plan: 1 of 3 in current phase (COMPLETE)
Status: Plan 02-01 complete — advancing to 02-02 (PanelHeader)
Last activity: 2026-03-14 — Plan 02-01 complete: react-mosaic v7 tiling layout, zustand panelStore, MosaicLayout, PanelWindow, PTY kill on onChange diff

Progress: [████████░░] 80%

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Average duration: 5.75 min
- Total execution time: 0.38 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 1 | 3 of 3 | 18 min | 6 min |
| Phase 2 | 1 of 3 | 5 min | 5 min |

**Recent Trend:**
- Last 5 plans: 01-01 (5 min), 01-02 (3 min), 01-03 (10 min), 02-01 (5 min)
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
- [01-03]: Import @xterm/xterm/css/xterm.css inside Terminal.tsx — terminal renders blank without it; co-location ensures the import is never forgotten
- [01-03]: vi.hoisted() required to declare mock constructor refs before vi.mock() factory executes — standard declarations are silently undefined due to Vitest hoisting
- [01-03]: sessionId uses useRef(crypto.randomUUID()) to remain stable across re-renders — avoids re-creating PTY session on unrelated state changes
- [01-03]: cwd passed as '.' from renderer, resolved to absolute path by ptyManager.ts via path.resolve — main process is authoritative over filesystem paths
- [02-01]: react-mosaic v7.0.0-beta0 installed (not v6.1.1) — uses n-ary MosaicSplitNode { type:'split', children:[], splitPercentages:[] } and MosaicPath = number[]
- [02-01]: MosaicWindowContext in v7 does NOT expose mosaicActions — use MosaicContext for mosaicActions.remove(path)
- [02-01]: ptyKill removed from Terminal.tsx cleanup; moved exclusively to MosaicLayout.handleChange diff to prevent double-kill

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1 RESOLVED]: node-pty ABI mismatch — resolved via postinstall script, rebuilt successfully for Electron 39.x arm64
- [Phase 4]: Attention detection regex corpus needs validation against real-world CLI tool output (npm init, git commit, pip, cargo) before implementation — false positives degrade UX
- [Phase 4]: node-pty 1.2.0-beta.12 has conpty improvements for Windows; monitor before committing to Windows release target

## Session Continuity

Last session: 2026-03-14
Stopped at: Completed 02-01-PLAN.md — tiling mosaic layout with zustand panel store, PTY lifecycle management
Resume file: None
