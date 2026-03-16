---
phase: 04-attention-detection-persistence
plan: "01"
subsystem: ui
tags: [electron, pty, notification, zustand, css-animation, ipc]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: ptyManager PTY session infrastructure, IPC preload bridge pattern
  - phase: 03-project-context-panel-identity
    provides: panelStore with PanelMeta, PanelHeader with color-dot element

provides:
  - ATTENTION_PATTERN regex in ptyManager with 5-second per-session cooldown
  - attentionService.ts with handleAttentionEvent for native OS notifications
  - pty:attention and panel:focus IPC push channels (preload with unsubscribe closures)
  - PanelMeta.attention boolean with setAttention/clearAttention in panelStore
  - Pulsing .attention-badge overlay on .color-dot in PanelHeader
  - Clear-on-click/focus in PanelWindow
  - App.tsx attention listener mounting with cleanup

affects: [04-02-persistence]

# Tech tracking
tech-stack:
  added: [Electron Notification API]
  patterns:
    - ptyManager accepts BrowserWindow (not WebContents) for notification access
    - attentionService module for notification side-effects (testable, isolated)
    - vi.mock() for attentionService in ptyManager tests to isolate notification side-effects

key-files:
  created:
    - src/main/attentionService.ts
    - tests/main/attentionService.test.ts
  modified:
    - src/main/ptyManager.ts
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/src/env.d.ts
    - src/renderer/src/store/panelStore.ts
    - src/renderer/src/components/PanelHeader.tsx
    - src/renderer/src/components/PanelWindow.tsx
    - src/renderer/src/App.tsx
    - src/renderer/src/assets/main.css
    - tests/main/ptyManager.test.ts
    - tests/store/panelStore.test.ts
    - tests/renderer/PanelHeader.test.tsx

key-decisions:
  - "registerPtyHandlers accepts BrowserWindow (not WebContents) so ptyManager can call handleAttentionEvent directly without extra IPC round-trip"
  - "attentionService extracted to separate module for testability — attentionService.ts mocked in ptyManager tests to isolate Notification side-effects"
  - "panel title not available in ptyManager layer — notification uses generic 'Terminal' title; renderer store has the actual title"
  - "Mock attentionService via vi.mock in ptyManager.test.ts to prevent Notification constructor from being called in test environment"
  - "attention:boolean defaults to false on addPanel — no separate initialization needed"

patterns-established:
  - "Pattern: ptyManager tests mock attentionService module to isolate PTY logic from notification side-effects"
  - "Pattern: IPC push channels follow onPtyData unsubscribe closure pattern — capture listener reference inside function, return () => removeListener"

requirements-completed: [ATTN-01, ATTN-02, ATTN-03]

# Metrics
duration: 5min
completed: 2026-03-16
---

# Phase 4 Plan 01: Attention Detection Summary

**PTY output watcher with conservative regex (y/N prompts, password, confirm), 5-second per-session cooldown, native OS notification via Electron Notification API, pulsing red badge on panel header, and IPC push channels for attention events**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-16T13:24:02Z
- **Completed:** 2026-03-16T13:29:00Z
- **Tasks:** 2 of 3 complete (Task 3 awaiting human verification)
- **Files modified:** 13

## Accomplishments

- ATTENTION_PATTERN regex matches high-confidence interactive prompts (y/N, password, confirm, press enter) with zero false positives on ls/npm/git output
- 5-second per-session cooldown prevents badge/notification spam from rapid-fire prompts like npm init
- Native OS notification fires via Electron Notification API when win.isFocused() is false; click restores window and focuses panel
- Pulsing red .attention-badge overlays .color-dot in PanelHeader using CSS keyframe animation (pulse-attention)
- 32 new tests added (26 attention detection + 6 renderer) — 99 total tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Attention detection in main process** - `67f9a15` (feat)
2. **Task 2: Renderer attention badge** - `b77c3c5` (feat)
3. **Task 3: Human verification** - awaiting checkpoint

## Files Created/Modified

- `src/main/attentionService.ts` - handleAttentionEvent: native Notification when app unfocused, click handler restores window + sends panel:focus
- `src/main/ptyManager.ts` - ATTENTION_PATTERN regex, 5s cooldown map, signature changed to BrowserWindow
- `src/main/index.ts` - registerPtyHandlers(win) call updated
- `src/preload/index.ts` - onAttention and onPanelFocus push channels with unsubscribe closures
- `src/preload/index.d.ts` - Type declarations for onAttention and onPanelFocus
- `src/renderer/src/env.d.ts` - Same type declarations for renderer
- `src/renderer/src/store/panelStore.ts` - attention:boolean field, setAttention/clearAttention actions
- `src/renderer/src/components/PanelHeader.tsx` - Conditional attention-badge span inside color-dot
- `src/renderer/src/components/PanelWindow.tsx` - onClick/onFocus calls clearAttention for badge dismissal
- `src/renderer/src/App.tsx` - useEffect mounting onAttention and onPanelFocus listeners with cleanup
- `src/renderer/src/assets/main.css` - .attention-badge CSS + @keyframes pulse-attention
- `tests/main/attentionService.test.ts` - 7 tests for handleAttentionEvent
- `tests/main/ptyManager.test.ts` - 20 new attention detection tests, signature update to BrowserWindow mock

## Decisions Made

- registerPtyHandlers accepts BrowserWindow (not WebContents) so attention notifications can be fired directly inside ptyManager without extra IPC round-trip
- attentionService extracted to separate module for testability — vi.mock() isolates it in ptyManager tests
- Panel title not available in ptyManager layer — notification uses generic "Terminal" title (panel store has actual title but is renderer-side)
- attention:boolean defaults false on addPanel — store update cascades to PanelHeader render automatically

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing panelStore test to match new PanelMeta shape**
- **Found during:** Task 2 GREEN phase (panelStore implementation)
- **Issue:** The existing test `addPanel adds entry with default title "Terminal" and default color "#569cd6"` used `toEqual({ title, color })` without the new `attention` field — strict equality caused failure
- **Fix:** Updated test expectation to `toEqual({ title: 'Terminal', color: '#569cd6', attention: false })`
- **Files modified:** tests/store/panelStore.test.ts
- **Verification:** pnpm test — all 99 tests pass
- **Committed in:** b77c3c5 (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added attentionService mock in ptyManager tests**
- **Found during:** Task 1 GREEN phase (ptyManager attention tests)
- **Issue:** ptyManager calls handleAttentionEvent which calls `new Notification(...)` — Electron Notification not mocked in ptyManager test environment, causing TypeError in onData path
- **Fix:** Added `vi.mock('../../src/main/attentionService', ...)` to ptyManager.test.ts to isolate test from Notification side-effects
- **Files modified:** tests/main/ptyManager.test.ts
- **Verification:** pnpm test — all 93 tests pass (at Task 1 completion)
- **Committed in:** 67f9a15 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug fix, 1 missing test isolation)
**Impact on plan:** Both auto-fixes necessary for test correctness. No scope creep.

## Issues Encountered

None — plan executed cleanly after the two auto-fixes above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Task 3 (human verification) pending: run `pnpm dev`, test interactive prompts, verify badge + notification
- After verification: Phase 4 Plan 02 (layout persistence) is ready to execute
- All IPC channels in place (pty:attention, panel:focus) — no further main-process changes needed for attention features

---
*Phase: 04-attention-detection-persistence*
*Completed: 2026-03-16*
