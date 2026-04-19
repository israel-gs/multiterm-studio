---
phase: 04-attention-detection-persistence
plan: '02'
subsystem: ui
tags: [electron, ipc, zustand, debounce, json, fs, layout-persistence]

# Dependency graph
requires:
  - phase: 04-01
    provides: panelStore with attention field, preload bridge pattern with unsubscribe closures, BrowserWindow-based IPC handler registration
  - phase: 03-project-context-panel-identity
    provides: folderPath in projectStore, MosaicLayout with handleChange diff pattern, panelStore PanelMeta shape

provides:
  - layoutManager.ts with saveLayout/saveLayoutSync/loadLayout/ensureGitignore for .multiterm/layout.json
  - layout:save and layout:load IPC handlers in main/index.ts with before-quit synchronous flush
  - layoutSave and layoutLoad preload channels (invoke-based)
  - scheduleSave debounced utility (1s, module-level singleton timer) in renderer/utils/layoutPersistence.ts
  - MosaicLayout savedLayout prop for tree + panel metadata restore
  - addPanel accepts optional title/color for restore path
  - App.tsx layout load flow after folder selection with layoutLoaded gate

affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'vi.hoisted() required for mock refs used inside vi.mock() factory — applied to both layoutManager.test.ts and MosaicLayout.test.tsx'
    - 'before-quit sync save pattern: lastSaveData module-level cache in index.ts updated on every layout:save, flushed synchronously on before-quit'
    - 'layoutLoaded gate in App.tsx prevents flash of default single panel before saved layout is loaded from disk'
    - 'usePanelStore.subscribe() in MosaicLayout wires title/color changes to scheduleSave without prop-drilling'

key-files:
  created:
    - src/main/layoutManager.ts
    - src/renderer/src/utils/layoutPersistence.ts
    - tests/main/layoutManager.test.ts
    - tests/renderer/layoutPersistence.test.ts
  modified:
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/src/env.d.ts
    - src/renderer/src/components/MosaicLayout.tsx
    - src/renderer/src/App.tsx
    - src/renderer/src/store/panelStore.ts
    - tests/renderer/MosaicLayout.test.tsx
    - tests/store/panelStore.test.ts

key-decisions:
  - 'lastSaveData module-level cache in index.ts (not per-window state) — single window app, simpler than passing layout through event args to before-quit handler'
  - 'scheduleSave uses module-level singleton timer (not hook-based) — ensures single debounce across all MosaicLayout re-renders, no stale closure issues'
  - 'layoutLoaded boolean gate in App.tsx — prevents flash of default single panel before async layoutLoad resolves'
  - 'addPanel signature extended with optional title/color (not a separate restorePanel action) — backward-compatible, all existing callers unaffected'
  - 'usePanelStore.subscribe() wired in MosaicLayout (not in individual PanelHeader) — centralizes all save-triggering in one place, avoids per-panel subscription overhead'

patterns-established:
  - 'Pattern: vi.hoisted() for any mock reference used inside vi.mock() factory — required due to Vitest hoisting vi.mock() before variable declarations'
  - 'Pattern: layout persistence utility (scheduleSave) is module-level singleton, not a React hook — survives re-renders without stale closure problems'

requirements-completed: [PERS-01, PERS-02, PERS-03]

# Metrics
duration: 9min
completed: 2026-03-16
---

# Phase 4 Plan 02: Layout Persistence Summary

**Per-project layout persistence: auto-save to .multiterm/layout.json on every tree/title/color change (debounced 1s), synchronous before-quit flush, instant restore on project reopen, .gitignore auto-add**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-03-16T13:38:03Z
- **Completed:** 2026-03-16T13:47:14Z
- **Tasks:** 3 of 3 complete (Task 3 human verification approved)
- **Files modified:** 13

## Accomplishments

- Layout snapshot (tree structure + panel titles + colors) auto-saves to `{folder}/.multiterm/layout.json` 1 second after the last change — covers split, resize, close, rename, recolor events
- Synchronous before-quit flush captures last-second changes that the debounce window may have missed
- Full restore on project reopen: MosaicLayout initializes from saved tree, each panel gets its original title/color via extended addPanel signature
- Corrupted or missing layout.json handled gracefully — app starts with fresh single panel, no crash
- .gitignore auto-updated with `.multiterm/` entry when .gitignore exists in the project folder
- 18 new tests (11 layoutManager + 3 layoutPersistence + 2 MosaicLayout restore + 2 panelStore optional params) — 117 total tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: LayoutManager service + IPC handlers + preload channels + before-quit save** - `a1eebe8` (feat)
2. **Task 2: Renderer layout save triggers + restore flow in MosaicLayout and App.tsx** - `e353649` (feat)
3. **Task 3: Human verification** - approved (interactive test confirmed all 9 behaviors)

## Files Created/Modified

- `src/main/layoutManager.ts` - saveLayout/saveLayoutSync/loadLayout/ensureGitignore with silent error handling
- `src/renderer/src/utils/layoutPersistence.ts` - scheduleSave debounced utility, module-level singleton timer
- `src/main/index.ts` - layout:save and layout:load IPC handlers, lastSaveData cache, before-quit sync flush
- `src/preload/index.ts` - layoutSave and layoutLoad invoke channels added
- `src/preload/index.d.ts` - Type declarations for layoutSave and layoutLoad
- `src/renderer/src/env.d.ts` - Same type declarations for renderer
- `src/renderer/src/components/MosaicLayout.tsx` - savedLayout prop, restore on mount, scheduleSave on tree change and store subscription
- `src/renderer/src/App.tsx` - layoutLoad after folder selection, layoutLoaded gate, savedLayout state
- `src/renderer/src/store/panelStore.ts` - addPanel extended with optional title/color parameters
- `tests/main/layoutManager.test.ts` - 11 tests covering all layoutManager functions
- `tests/renderer/layoutPersistence.test.ts` - 3 debounce tests with fake timers
- `tests/renderer/MosaicLayout.test.tsx` - 2 restore tests added, mockScheduleSave via vi.hoisted()
- `tests/store/panelStore.test.ts` - 2 optional addPanel parameter tests added

## Decisions Made

- `lastSaveData` module-level cache in `index.ts` (not per-window state) — single-window app, simpler than forwarding layout data through before-quit event args
- `scheduleSave` uses module-level singleton timer (not a React hook) — survives MosaicLayout re-renders without stale closure issues
- `layoutLoaded` boolean gate in App.tsx prevents flash of a default single panel before the async `layoutLoad` IPC call resolves
- `addPanel` extended with optional `title?/color?` (not a separate `restorePanel` action) — backward-compatible, all 10+ existing call sites unaffected
- `usePanelStore.subscribe()` wired centrally in MosaicLayout (not per-panel) — one subscription handles all title/color changes, avoids N subscriptions for N panels

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.hoisted() required for mockMkdir/mockWriteFile/etc. in layoutManager.test.ts**

- **Found during:** Task 1 RED/GREEN phase (first test run)
- **Issue:** `vi.mock('fs/promises', () => ({ mkdir: mockMkdir, ... }))` — mock factory is hoisted to top of file by Vitest before `const mockMkdir = vi.fn()` declaration, causing `ReferenceError: Cannot access 'mockMkdir' before initialization`
- **Fix:** Wrapped all mock vi.fn() declarations in `vi.hoisted(() => ({ ... }))` — same fix pattern already established in Phase 02 and 04-01
- **Files modified:** tests/main/layoutManager.test.ts
- **Verification:** pnpm test — all tests pass
- **Committed in:** a1eebe8 (Task 1 commit, test was re-written before committing)

**2. [Rule 1 - Bug] vi.hoisted() required for mockScheduleSave in MosaicLayout.test.tsx**

- **Found during:** Task 2 GREEN phase (first test run after adding layoutPersistence mock)
- **Issue:** Same hoisting issue — `vi.mock('@renderer/utils/layoutPersistence', () => ({ scheduleSave: mockScheduleSave }))` caused `ReferenceError` because `const mockScheduleSave = vi.fn()` is not yet initialized when the factory runs
- **Fix:** Wrapped in `vi.hoisted(() => ({ mockScheduleSave: vi.fn() }))`
- **Files modified:** tests/renderer/MosaicLayout.test.tsx
- **Verification:** pnpm test — all 117 tests pass
- **Committed in:** e353649 (Task 2 commit, fix applied before committing)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — same hoisting pattern, different test files)
**Impact on plan:** Both fixes are mechanical applications of the established vi.hoisted() pattern from previous phases. No scope creep.

## Issues Encountered

None beyond the two vi.hoisted() fixes above — plan executed cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 4 is complete — both ATTN and PERS requirement groups fulfilled
- Human verification approved — all 9 interactive behaviors confirmed working (auto-save, .gitignore, restore, fresh-start on missing/corrupted file)
- All 117 tests pass, TypeScript build clean
- Project milestone v1.0 is complete: project-aware terminals with per-project layout persistence and attention detection

---

_Phase: 04-attention-detection-persistence_
_Completed: 2026-03-16_

## Self-Check: PASSED

- src/main/layoutManager.ts — FOUND
- src/renderer/src/utils/layoutPersistence.ts — FOUND
- 04-02-SUMMARY.md — FOUND
- Commit a1eebe8 — FOUND
- Commit e353649 — FOUND
