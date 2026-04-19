---
phase: 02-multi-panel-layout
plan: '01'
subsystem: ui
tags: [react-mosaic, zustand, tiling-layout, pty-lifecycle, electron, react]

# Dependency graph
requires:
  - phase: 01-03
    provides: TerminalPanel component (sessionId, cwd props), electronAPI IPC bridge (ptyCreate, ptyKill, onPtyData)
provides:
  - Controlled Mosaic<string> tiling layout with onChange PTY lifecycle management
  - Zustand panelStore with addPanel/removePanel/setTitle/setColor
  - MosaicLayout.tsx, PanelWindow.tsx, updated App.tsx, updated Terminal.tsx
  - 10 new unit tests (6 panelStore + 4 MosaicLayout)
affects:
  - Phase 02-02 (PanelHeader will replace PanelWindow's minimal renderToolbar placeholder)
  - Phase 03 (project-aware cwd will be injected via MosaicLayout -> PanelWindow -> TerminalPanel)

# Tech tracking
tech-stack:
  added:
    - 'react-mosaic-component@7.0.0-beta0'
    - 'zustand@5.0.x'
  patterns:
    - 'TDD RED→GREEN: failing test committed before implementation'
    - "react-mosaic v7 n-ary API: MosaicSplitNode { type: 'split', direction, children[], splitPercentages[] }"
    - 'Controlled Mosaic mode: value + onChange, treeRef for diff comparison'
    - 'PTY kill in onChange diff only (not in Terminal cleanup) to prevent double-kill'
    - 'MosaicContext (not MosaicWindowContext) used for mosaicActions.remove in v7'

key-files:
  created:
    - src/renderer/src/store/panelStore.ts
    - src/renderer/src/components/MosaicLayout.tsx
    - src/renderer/src/components/PanelWindow.tsx
    - tests/store/panelStore.test.ts
    - tests/renderer/MosaicLayout.test.tsx
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/components/Terminal.tsx
    - src/renderer/src/assets/global.css
    - tests/renderer/Terminal.test.tsx
    - package.json

key-decisions:
  - "react-mosaic v7 (n-ary API) was installed instead of expected v6 (binary API) — adapted implementation to use MosaicSplitNode with type:'split', children:[], MosaicPath as number[]"
  - 'MosaicWindowContext in v7 does not expose mosaicActions.remove — use MosaicContext instead for the close button'
  - 'ptyKill removed from Terminal.tsx useEffect cleanup; moved exclusively to MosaicLayout.handleChange diff to prevent double-kill (research pitfall 2)'
  - 'getLeavesImpl manual implementation in tests to support both v7 n-ary nodes and string leaves without jest-dom dependency'

# Metrics
duration: ~4 min
completed: 2026-03-14
---

# Phase 2 Plan 01: Multi-Panel Mosaic Layout Summary

**Tiling workspace with react-mosaic v7 n-ary layout, zustand panel store, and PTY lifecycle management via onChange tree diff**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-14T02:23:44Z
- **Completed:** 2026-03-14T02:28:00Z
- **Tasks:** 2 (both TDD: RED commit + GREEN commit each)
- **Files modified:** 9

## Accomplishments

- panelStore.ts: zustand store with addPanel/removePanel/setTitle/setColor; defaults title='Terminal', color='#569cd6'
- MosaicLayout.tsx: controlled Mosaic<string> with initialId via useRef, treeRef for diff, handleChange diffs old/new leaves and calls ptyKill for removed panels, handleAddPanel wraps tree in n-ary split node, zeroStateView and global "+ New terminal" button
- PanelWindow.tsx: MosaicWindow wrapper with minimal renderToolbar (close button via MosaicContext), TerminalPanel child with width/height 100%
- App.tsx: replaced single TerminalPanel with MosaicLayout; removed sessionId useRef
- Terminal.tsx: removed ptyKill from useEffect cleanup (moved to MosaicLayout.handleChange)
- global.css: dark theme overrides for .mosaic-root, .mosaic-split, .mosaic-tile, .mosaic-window-toolbar, .mosaic-window-body
- All 43 tests pass (33 Phase 1 + 6 panelStore + 4 MosaicLayout)
- npm run build succeeds with no TypeScript errors

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: panelStore (TDD RED)** — `26fa605` (test)
2. **Task 1: panelStore (TDD GREEN)** — `90959c5` (feat)
3. **Task 2: MosaicLayout (TDD RED)** — `19069fd` (test)
4. **Task 2: MosaicLayout (TDD GREEN)** — `5dcb34a` (feat)

_Note: TDD tasks have two commits — failing tests first (RED), then implementation (GREEN)._

## Files Created/Modified

**Created:**

- `src/renderer/src/store/panelStore.ts` — zustand store for panel metadata (title, color per sessionId)
- `src/renderer/src/components/MosaicLayout.tsx` — controlled Mosaic<string> wrapper with onChange diff, addPanel, zero-state
- `src/renderer/src/components/PanelWindow.tsx` — MosaicWindow wrapper with renderToolbar and TerminalPanel child
- `tests/store/panelStore.test.ts` — 6 unit tests for panelStore actions
- `tests/renderer/MosaicLayout.test.tsx` — 4 unit tests for mosaic layout behavior

**Modified:**

- `src/renderer/src/App.tsx` — replaced single TerminalPanel with MosaicLayout
- `src/renderer/src/components/Terminal.tsx` — removed ptyKill from cleanup (moved to MosaicLayout)
- `src/renderer/src/assets/global.css` — dark theme overrides for react-mosaic v7
- `tests/renderer/Terminal.test.tsx` — updated ptyKill assertion to reflect new cleanup behavior
- `package.json` — added react-mosaic-component and zustand as dependencies

## Decisions Made

- react-mosaic v7.0.0-beta0 was installed instead of expected v6.1.1. The v7 API uses n-ary tree nodes (`MosaicSplitNode` with `type: 'split'`, `children: MosaicNode<T>[]`, `splitPercentages?: number[]`) instead of the v6 binary tree (`{ direction, first, second, splitPercentage }`). `MosaicPath` is now `number[]` instead of `('first'|'second')[]`. Implementation was adapted to use v7 API natively.
- `MosaicWindowContext` in v7 only exposes `mosaicWindowActions` (not `mosaicActions`). The close button in PanelWindow uses `MosaicContext` (the root context) to call `mosaicActions.remove(path)`.
- `ptyKill` removed from `Terminal.tsx` useEffect cleanup, moved exclusively to `MosaicLayout.handleChange` diff handler, preventing double-kill when the mosaic tree removes a leaf (research pitfall 2 from 02-RESEARCH.md).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] react-mosaic v7 instead of expected v6 — adapted to n-ary API**

- **Found during:** Task 1 (post-install version check)
- **Issue:** npm installed react-mosaic-component@7.0.0-beta0 (not v6.1.1 as expected). The v7 API has a fundamentally different n-ary tree shape and updated context exports.
- **Fix:** Implemented MosaicLayout and PanelWindow using v7 n-ary API (`MosaicSplitNode`, `MosaicPath = number[]`, `MosaicContext` for remove action). The v7 API is still backward compatible for controlled mode (accepts `LegacyMosaicNode` in `value` prop).
- **Files modified:** `src/renderer/src/components/MosaicLayout.tsx`, `src/renderer/src/components/PanelWindow.tsx`, `tests/renderer/MosaicLayout.test.tsx`
- **Commits:** `90959c5`, `5dcb34a`

**2. [Rule 2 - Missing] `toBeInTheDocument` not available without jest-dom setup**

- **Found during:** Task 2 GREEN test run (1 of 4 tests failed)
- **Issue:** `@testing-library/jest-dom` matchers not configured in vitest setup file; `toBeInTheDocument()` is not available.
- **Fix:** Changed assertion to use `expect(...).toBeTruthy()` and `expect(getLeavesImpl(mosaicValue)).toHaveLength(1)` — equivalent semantics without jest-dom dependency.
- **Files modified:** `tests/renderer/MosaicLayout.test.tsx`
- **Commit:** `5dcb34a`

## Self-Check: PASSED

All created files exist on disk. All 4 task commits confirmed in git log.

| Item                                                    | Status |
| ------------------------------------------------------- | ------ |
| src/renderer/src/store/panelStore.ts                    | FOUND  |
| src/renderer/src/components/MosaicLayout.tsx            | FOUND  |
| src/renderer/src/components/PanelWindow.tsx             | FOUND  |
| tests/store/panelStore.test.ts                          | FOUND  |
| tests/renderer/MosaicLayout.test.tsx                    | FOUND  |
| .planning/phases/02-multi-panel-layout/02-01-SUMMARY.md | FOUND  |
| Commit 26fa605 (test RED panelStore)                    | FOUND  |
| Commit 90959c5 (feat GREEN panelStore)                  | FOUND  |
| Commit 19069fd (test RED MosaicLayout)                  | FOUND  |
| Commit 5dcb34a (feat GREEN MosaicLayout)                | FOUND  |
