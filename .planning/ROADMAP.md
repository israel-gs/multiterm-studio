# Roadmap: Multiterm Studio

## Overview

Four phases that build from foundation to differentiators. Phase 1 establishes the secure Electron architecture and delivers a working single-panel terminal — nothing else is valid without it. Phase 2 expands to the full tiling canvas. Phase 3 adds project identity and panel personalization. Phase 4 ships the features that make this product distinct: proactive output attention detection and per-project layout persistence.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation + Terminal Core** - Secure Electron scaffold with real PTY session in a single panel
- [ ] **Phase 2: Multi-Panel Layout** - Tiling canvas with N panels, each with their own PTY
- [ ] **Phase 3: Project Context + Panel Identity** - File tree sidebar, folder-on-launch, editable panel headers with color
- [ ] **Phase 4: Attention Detection + Persistence** - Output watcher, native notifications, and per-project layout save/restore

## Phase Details

### Phase 1: Foundation + Terminal Core
**Goal**: User can open a project folder and interact with a real shell session in a single terminal panel, with all IPC infrastructure correctly established
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, TERM-01, TERM-02, TERM-03, TERM-04, TERM-05, TERM-06, TERM-07, TERM-08, TERM-09
**Success Criteria** (what must be TRUE):
  1. Running `npm install && npm run dev` starts the Electron app with no errors and a visible terminal panel
  2. User types a command (e.g., `pwd`) and sees the correct output — the shell session is real, not simulated
  3. The terminal panel opens with cwd set to the project folder the user opened
  4. Terminal renders ANSI colors, handles Ctrl+C, and resizes correctly when the window is resized
  5. Clicking a URL in terminal output opens it in the system browser
**Plans:** 3 plans

Plans:
- [x] 01-01-PLAN.md — Electron + electron-vite scaffold with contextIsolation, IPC bridge, dark theme, and Wave 0 test scaffolds
- [x] 01-02-PLAN.md — PTY manager in main process with pty:create/write/resize/kill/data IPC handlers
- [x] 01-03-PLAN.md — Renderer terminal panel with xterm.js, FitAddon, WebLinksAddon, ResizeObserver, and human verification

### Phase 2: Multi-Panel Layout
**Goal**: User can work with multiple terminal panels simultaneously — splitting, resizing, closing, and adding panels — each with its own live PTY session
**Depends on**: Phase 1
**Requirements**: LAYOUT-01, LAYOUT-02, LAYOUT-03, LAYOUT-04, LAYOUT-05, LAYOUT-06, LAYOUT-07, LAYOUT-08
**Success Criteria** (what must be TRUE):
  1. User can split any panel horizontally or vertically and both halves have working terminal sessions
  2. User can drag dividers between panels to resize them, and terminal output re-renders correctly after resize
  3. User can close a panel with the header close button; the associated PTY process is killed (no zombie processes)
  4. Clicking "+ New terminal" adds a new panel with a fresh shell session in the project cwd
**Plans:** 2 plans

Plans:
- [ ] 02-01-PLAN.md — Zustand panel store + react-mosaic controlled tiling layout with PTY lifecycle management
- [ ] 02-02-PLAN.md — PanelHeader with editable title, color dot picker, split/close buttons, and human verification

### Phase 3: Project Context + Panel Identity
**Goal**: The application feels project-aware — a folder picker on launch, a visible file tree sidebar, and panels with meaningful identities (custom names and colors)
**Depends on**: Phase 2
**Requirements**: PROJ-01, PROJ-02, PROJ-03
**Success Criteria** (what must be TRUE):
  1. On first launch (no prior folder), a native folder picker dialog opens automatically
  2. The left sidebar displays the file tree of the opened project folder with expandable directories
  3. User can double-click a panel header to rename it; the new name persists while the app is open
**Plans**: TBD

Plans:
- [ ] 03-01: FolderService with folder:open and folder:readdir IPC, FileTree renderer component with lazy expand/collapse

### Phase 4: Attention Detection + Persistence
**Goal**: Users never miss a terminal prompt that needs input, and their panel layout survives closing and reopening the project
**Depends on**: Phase 3
**Requirements**: ATTN-01, ATTN-02, ATTN-03, PERS-01, PERS-02, PERS-03
**Success Criteria** (what must be TRUE):
  1. Running an interactive CLI command (e.g., `npm init`) causes the panel header to show a pulsing badge
  2. When the app is in the background during an attention event, a native OS notification appears
  3. After closing the app and reopening the same project folder, all panels are restored with their previous titles, colors, and layout arrangement
  4. Layout changes (split, resize, rename) are auto-saved without any user action required
**Plans**: TBD

Plans:
- [ ] 04-01: AttentionWatcher inline in PtyManager onData pipeline with pulsing badge and native notification
- [ ] 04-02: LayoutPersistence service with debounced save to .multiterm/layout.json and restore on folder:open

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation + Terminal Core | 3/3 | Complete | 2026-03-14 |
| 2. Multi-Panel Layout | 0/2 | Planned | - |
| 3. Project Context + Panel Identity | 0/1 | Not started | - |
| 4. Attention Detection + Persistence | 0/2 | Not started | - |
