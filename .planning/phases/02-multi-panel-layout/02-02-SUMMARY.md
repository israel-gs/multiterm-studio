---
phase: 02-multi-panel-layout
plan: "02"
subsystem: ui
tags: [react-mosaic, zustand, panel-header, tdd, tiling-layout, color-picker, electron, react]

# Dependency graph
requires:
  - phase: 02-01
    provides: Controlled Mosaic<string> tiling layout, zustand panelStore with addPanel/setTitle/setColor, PanelWindow with placeholder renderToolbar, MosaicContext/MosaicWindowContext API patterns

provides:
  - PanelHeader component with editable title (double-click), 6-color preset picker, split button (MosaicWindowActions.split), close button (MosaicRootActions.remove)
  - PanelWindow.tsx updated to use PanelHeader via renderToolbar
  - global.css panel-header classes (color-dot, color-option, panel-header-btn, etc.)
  - 8 new unit tests for PanelHeader interactions

affects:
  - Phase 03 (project-aware cwd injection via MosaicLayout -> PanelWindow -> PanelHeader -> TerminalPanel)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TDD RED->GREEN: failing test committed before implementation (628c72b -> 23f9f0b)"
    - "vi.hoisted() for mock references used inside vi.mock() factory — prevents ReferenceError from Vitest hoisting"
    - "Dual context consumption: MosaicWindowContext (split) + MosaicContext (remove) in same component"
    - "renderWithContexts helper wraps PanelHeader in both MosaicWindowContext.Provider and MosaicContext.Provider for isolation"

key-files:
  created:
    - src/renderer/src/components/PanelHeader.tsx
    - tests/renderer/PanelHeader.test.tsx
  modified:
    - src/renderer/src/components/PanelWindow.tsx
    - src/renderer/src/assets/global.css

key-decisions:
  - "vi.hoisted() required for mockSplit and mockRemove — they are referenced inside vi.mock() factory which is hoisted before variable declarations"
  - "PanelHeader uses both MosaicWindowContext (for mosaicWindowActions.split) and MosaicContext (for mosaicActions.remove) — v7 API separates these"
  - "color-dot background set via inline style (not CSS class) so tests can assert style.background value"

patterns-established:
  - "Dual context helper: renderWithContexts() wraps both MosaicWindowContext.Provider and MosaicContext.Provider"

requirements-completed: [LAYOUT-02, LAYOUT-04, LAYOUT-06, LAYOUT-07]

# Metrics
duration: ~2 min
completed: 2026-03-14
---

# Phase 2 Plan 02: PanelHeader Component Summary

**PanelHeader with editable title (double-click), 6-preset color dot picker, split button (MosaicWindowActions.split), and close button (MosaicContext.remove) — all wired to zustand panelStore**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-03-14T07:31:28Z
- **Completed:** 2026-03-14T07:33:55Z
- **Tasks:** 1 complete (Task 2 awaits human verification)
- **Files modified:** 4

## Accomplishments

- PanelHeader.tsx: editable title (double-click to edit, blur/Enter to save), 6 preset color options (always visible as small dots), split button, close button
- PanelWindow.tsx: removed inline placeholder toolbar, now uses `renderToolbar={() => <PanelHeader sessionId={sessionId} path={path} />}`
- global.css: panel-header, panel-header-title, panel-header-input, panel-header-btn, color-dot, color-option CSS classes added
- 8 PanelHeader tests pass; 51 total tests pass; build clean

## Task Commits

TDD: RED then GREEN per task:

1. **Task 1: PanelHeader (TDD RED)** — `628c72b` (test) — 8 failing tests
2. **Task 1: PanelHeader (TDD GREEN)** — `23f9f0b` (feat) — implementation + all 51 tests pass

_Note: TDD tasks have two commits — failing tests first (RED), then implementation (GREEN)._

## Files Created/Modified

**Created:**
- `src/renderer/src/components/PanelHeader.tsx` — PanelHeader with editable title, color picker, split/close buttons
- `tests/renderer/PanelHeader.test.tsx` — 8 unit tests for all header interactions

**Modified:**
- `src/renderer/src/components/PanelWindow.tsx` — replaced inline placeholder with `<PanelHeader>` via renderToolbar
- `src/renderer/src/assets/global.css` — panel-header CSS classes appended

## Decisions Made

- **vi.hoisted() for mock references**: `mockSplit` and `mockRemove` need to be hoisted with `vi.hoisted()` because they are referenced inside the `vi.mock()` factory, which is hoisted to the top of the file by Vitest before variable declarations are evaluated. Without hoisting, `ReferenceError: Cannot access 'mockSplit' before initialization` occurs.
- **Dual context consumption**: `PanelHeader` uses `useContext(MosaicWindowContext)` for `mosaicWindowActions.split()` and `useContext(MosaicContext)` for `mosaicActions.remove(path)`. This is the correct v7 API (previously documented: MosaicWindowContext only has `mosaicWindowActions`, not `mosaicActions`).
- **Inline style for color dot**: The color dot uses `style={{ background: panel.color }}` so tests can assert `element.style.background` with specific hex values converted to rgb.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] vi.hoisted() required for mock variables in vi.mock() factory**
- **Found during:** Task 1 (TDD GREEN — first test run after PanelHeader.tsx created)
- **Issue:** `mockSplit` and `mockRemove` were declared with `vi.fn()` at module level, then referenced inside `vi.mock('react-mosaic-component', ...)` factory. Vitest hoists `vi.mock()` to top of file, causing `ReferenceError: Cannot access 'mockSplit' before initialization`.
- **Fix:** Changed to `const { mockSplit, mockRemove } = vi.hoisted(() => ({ mockSplit: vi.fn(), mockRemove: vi.fn() }))`. Tests now pass.
- **Files modified:** `tests/renderer/PanelHeader.test.tsx`
- **Verification:** All 8 tests pass after fix
- **Committed in:** `23f9f0b` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test setup)
**Impact on plan:** Necessary fix for test infrastructure. No scope creep.

## Issues Encountered

None beyond the vi.hoisted() fix above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- PanelHeader complete; ready for human verification of full multi-panel experience
- Phase 03 (project-aware cwd) can consume PanelHeader as-is — no changes needed to interface

---
*Phase: 02-multi-panel-layout*
*Completed: 2026-03-14*
