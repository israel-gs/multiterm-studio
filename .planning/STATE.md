# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-14)

**Core value:** Terminals that are project-aware: every panel inherits the project's working directory, layout and sessions persist per-project, and an output watcher alerts you when a long-running process needs attention.
**Current focus:** Phase 1 — Foundation + Terminal Core

## Current Position

Phase: 1 of 4 (Foundation + Terminal Core)
Plan: 0 of 3 in current phase
Status: Ready to plan
Last activity: 2026-03-14 — Roadmap created; 31 v1 requirements mapped to 4 phases

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-Phase 1]: Use `@xterm/*` scoped packages (v6) only — unscoped `xterm` packages are deprecated and frozen
- [Pre-Phase 1]: node-pty must be in `dependencies` (not devDependencies) and externalized from Vite bundle via `rollupOptions.external`
- [Pre-Phase 1]: IPC push listeners must expose unsubscribe closures from contextBridge — removeListener does not work through the bridge

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 1]: node-pty ABI mismatch is a high-probability build failure — postinstall script (`electron-builder install-app-deps`) must be added before any npm install
- [Phase 4]: Attention detection regex corpus needs validation against real-world CLI tool output (npm init, git commit, pip, cargo) before implementation — false positives degrade UX
- [Phase 4]: node-pty 1.2.0-beta.12 has conpty improvements for Windows; monitor before committing to Windows release target

## Session Continuity

Last session: 2026-03-14
Stopped at: Roadmap created, files written, ready to plan Phase 1
Resume file: None
