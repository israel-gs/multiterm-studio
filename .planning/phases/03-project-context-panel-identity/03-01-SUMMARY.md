---
phase: 03-project-context-panel-identity
plan: '01'
subsystem: ipc
tags: [electron, ipc, zustand, fs, dialog, contextBridge, typescript]

# Dependency graph
requires:
  - phase: 02-multi-panel-layout
    provides: PTY IPC pattern, contextBridge pattern, Zustand store pattern established in phases 1 and 2

provides:
  - folder:open IPC handler (dialog.showOpenDialog, openDirectory) exposed via contextBridge as folderOpen
  - folder:readdir IPC handler (fs/promises readdir, sorted/filtered entries) exposed via contextBridge as folderReaddir
  - useProjectStore Zustand slice with folderPath state and setFolderPath action
  - Type declarations in preload/index.d.ts and renderer/src/env.d.ts for both new bridge methods

affects:
  - 03-02 (file tree sidebar will consume folderReaddir and useProjectStore)
  - 03-03 (folder-picker-on-launch UI will use folderOpen and setFolderPath)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'registerFolderHandlers(win: BrowserWindow) — same capturedHandlers dict pattern as ptyManager'
    - 'fs/promises mock in Vitest requires { default: { readdir }, readdir } dual-export to satisfy ESM named import'

key-files:
  created:
    - src/main/folderManager.ts
    - src/renderer/src/store/projectStore.ts
    - tests/main/folderManager.test.ts
    - tests/store/projectStore.test.ts
  modified:
    - src/main/index.ts
    - src/preload/index.ts
    - src/preload/index.d.ts
    - src/renderer/src/env.d.ts

key-decisions:
  - 'folderManager takes full BrowserWindow (not WebContents) because dialog.showOpenDialog needs window reference for modal behavior'
  - 'fs/promises mock in Vitest ESM requires both default and named export keys: { default: { readdir }, readdir } — importOriginal spread silently falls through to real fs in this setup'
  - "folder:readdir filters entries where name starts with '.' OR equals 'node_modules' before mapping and sorting"

patterns-established:
  - 'IPC handler module follows registerXHandlers(win) naming, registered in index.ts after PTY handlers'
  - "Vitest fs/promises mock: vi.mock('fs/promises', () => ({ default: { fn }, fn })) for ESM named import compatibility"

requirements-completed: [PROJ-01, PROJ-02]

# Metrics
duration: 2min
completed: 2026-03-16
---

# Phase 3 Plan 1: FolderService IPC + ProjectStore Summary

**Electron IPC folder:open (dialog picker) and folder:readdir (sorted/filtered fs entries) with contextBridge extension and useProjectStore Zustand slice — 12 unit tests, full suite green, build passes**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-16T05:36:52Z
- **Completed:** 2026-03-16T05:39:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Created folderManager.ts registering folder:open (native dialog picker, returns path or null) and folder:readdir (readdir with dotfile/node_modules filter, dir-first sort)
- Extended contextBridge in preload/index.ts with folderOpen and folderReaddir; updated both type declaration files
- Wired registerFolderHandlers(win) into main/index.ts createWindow after PTY handlers
- Created useProjectStore Zustand slice (folderPath: null, setFolderPath) following existing panelStore pattern
- 12 new unit tests added; all 63 tests in suite pass; build succeeds

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: folderManager failing tests** - `47d59d3` (test)
2. **Task 1 GREEN: folderManager implementation + preload + types** - `29f4e49` (feat)
3. **Task 2 RED: projectStore failing tests** - `4f3249e` (test)
4. **Task 2 GREEN: useProjectStore implementation** - `061dd56` (feat)

_Note: TDD tasks have separate RED (test) and GREEN (feat) commits_

## Files Created/Modified

- `src/main/folderManager.ts` - folder:open and folder:readdir IPC handlers, exports registerFolderHandlers
- `src/main/index.ts` - import and call registerFolderHandlers(win) in createWindow
- `src/preload/index.ts` - folderOpen and folderReaddir added to contextBridge exposeInMainWorld
- `src/preload/index.d.ts` - type declarations for folderOpen and folderReaddir
- `src/renderer/src/env.d.ts` - same type declarations for renderer Window.electronAPI
- `src/renderer/src/store/projectStore.ts` - useProjectStore with folderPath and setFolderPath
- `tests/main/folderManager.test.ts` - 9 unit tests covering all IPC handler behaviors
- `tests/store/projectStore.test.ts` - 3 unit tests covering initial state and setFolderPath

## Decisions Made

- folderManager takes full `BrowserWindow` (not `WebContents`) because `dialog.showOpenDialog` requires a window reference for native modal behavior
- Vitest ESM mocking for `fs/promises` named imports requires `{ default: { readdir }, readdir }` dual-export — the `importOriginal` spread approach silently falls through to real `fs` in this Vitest/Vite version
- folder:readdir filters entries with `name.startsWith('.')` OR `name === 'node_modules'` before mapping, then sorts dirs-first then alphabetical via localeCompare

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed fs/promises mock failing to intercept readdir in Vitest ESM**

- **Found during:** Task 1 GREEN verification
- **Issue:** `vi.mock('fs/promises', async (importOriginal) => { ...actual, readdir: mockReaddir })` spread caused real `readdir` to be called, throwing ENOENT for `/some/dir`
- **Fix:** Changed mock to `vi.mock('fs/promises', () => ({ default: { readdir: mockReaddir }, readdir: mockReaddir }))` — provides both default and named export keys required by Vitest ESM
- **Files modified:** `tests/main/folderManager.test.ts`
- **Verification:** All 9 folderManager tests pass with mock correctly intercepting readdir
- **Committed in:** `29f4e49` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in mock setup)
**Impact on plan:** Fix required for test correctness. No scope creep.

## Issues Encountered

- Vitest ESM handling of Node built-in `fs/promises` with named imports requires explicit default+named dual-export mock factory — `importOriginal` spread does not substitute properly in this Vite 7 / Vitest 3 configuration.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- folder:open and folder:readdir IPC handlers are wired and tested — Plan 02 (file tree sidebar) can consume folderReaddir immediately
- useProjectStore folderPath slice is ready — Plan 03 (folder-picker-on-launch) can call setFolderPath after dialog
- No blockers

---

_Phase: 03-project-context-panel-identity_
_Completed: 2026-03-16_
