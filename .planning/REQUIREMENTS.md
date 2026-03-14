# Requirements: Multiterm Studio

**Defined:** 2026-03-14
**Core Value:** Terminals that are project-aware: every panel inherits the project's working directory, layout and sessions persist per-project, and an output watcher alerts you when a long-running process needs attention.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Terminal Core

- [x] **TERM-01**: User can open a real shell session (bash/zsh on macOS/Linux, cmd/powershell on Windows) in each terminal panel
- [x] **TERM-02**: Each panel's shell starts with cwd set to the opened project folder
- [x] **TERM-03**: Terminal renders with xterm.js including FitAddon and WebLinksAddon
- [x] **TERM-04**: PTY resizes correctly when panel is resized (FitAddon + ResizeObserver → pty:resize IPC)
- [x] **TERM-05**: Terminal supports scrollback buffer (10,000+ lines)
- [x] **TERM-06**: Terminal renders ANSI colors, 256-color, and 24-bit color correctly
- [x] **TERM-07**: Terminal supports Unicode and emoji rendering
- [x] **TERM-08**: Keyboard input passes through to PTY correctly (Ctrl+C, arrow keys, tab completion)
- [x] **TERM-09**: User can copy selected text and paste from clipboard

### Attention Detection

- [ ] **ATTN-01**: Main process monitors each PTY's stdout for patterns indicating user attention needed (prompts "?", "> ", "Do you want", ANSI pause sequences)
- [ ] **ATTN-02**: When attention pattern detected, panel header shows a pulsing badge
- [ ] **ATTN-03**: When attention pattern detected, a native OS notification fires (if app is backgrounded)

### Layout & Panels

- [x] **LAYOUT-01**: Terminal panels are arranged in a tiling layout using react-mosaic
- [ ] **LAYOUT-02**: User can split panels horizontally and vertically
- [x] **LAYOUT-03**: User can resize panels by dragging dividers
- [ ] **LAYOUT-04**: User can close individual panels via header close button
- [x] **LAYOUT-05**: Global "+ New terminal" button adds a new panel to the canvas
- [ ] **LAYOUT-06**: Panel header displays editable session title (double-click to edit)
- [ ] **LAYOUT-07**: Panel header has a color dot picker with 6 preset colors
- [x] **LAYOUT-08**: Closing a panel kills the associated PTY process

### Project Context

- [ ] **PROJ-01**: On launch, if no folder is loaded, a native folder picker dialog opens
- [ ] **PROJ-02**: Left sidebar displays a file tree of the opened project folder
- [ ] **PROJ-03**: File tree supports expand/collapse of directories

### Persistence

- [ ] **PERS-01**: Layout (panel arrangement, sizes) and session metadata (titles, colors) are saved to a local JSON config file per project
- [ ] **PERS-02**: Layout saves automatically on change
- [ ] **PERS-03**: Layout restores automatically when reopening the same project folder

### Infrastructure

- [x] **INFRA-01**: Electron app runs with contextIsolation: true and nodeIntegration: false
- [x] **INFRA-02**: All main↔renderer communication uses IPC via contextBridge (pty:create, pty:write, pty:resize, pty:kill, pty:data, pty:attention, folder:open, folder:readdir)
- [x] **INFRA-03**: node-pty instances are managed exclusively in the main process
- [x] **INFRA-04**: App builds and launches with `npm install && npm run dev` using electron-vite
- [x] **INFRA-05**: Dark theme styling (background #1a1a1a, panels #242424, headers #2e2e2e)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Keyboard Shortcuts

- **KEY-01**: Keyboard shortcut to split panel (Cmd+D / Ctrl+D)
- **KEY-02**: Right-click context menu (copy, paste, clear)
- **KEY-03**: Keyboard shortcuts reference overlay

### CLI Integration

- **CLI-01**: Launch from CLI with project path argument (`multiterm-studio .`)

### Packaging

- **PKG-01**: Auto-update mechanism via electron-updater
- **PKG-02**: Installable builds for macOS, Windows, and Linux via electron-builder

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| SSH / remote terminal sessions | Large scope addition; users can `ssh` in a panel normally |
| Plugin / extension API | Requires stable internal APIs; defer until architecture is proven |
| Built-in text editor | This is a terminal tool, not an IDE; file tree is read-only reference |
| Tabs alongside tiles | Two layout paradigms conflict; tiles-only is a deliberate UX decision |
| AI command assistant | Requires cloud API, privacy policy; contradicts local-first philosophy |
| Settings / preferences UI | Ship with sensible defaults; JSON config for power users in v1 |
| Session content restoration after reboot | Requires PTY daemon architecture; layout metadata persists, shell content does not |
| Multiple windows for same project | State sync creates race conditions; single window per project |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TERM-01 | Phase 1 | Complete (01-02) |
| TERM-02 | Phase 1 | Complete (01-02) |
| TERM-03 | Phase 1 | Complete |
| TERM-04 | Phase 1 | Complete |
| TERM-05 | Phase 1 | Complete |
| TERM-06 | Phase 1 | Complete |
| TERM-07 | Phase 1 | Complete |
| TERM-08 | Phase 1 | Complete |
| TERM-09 | Phase 1 | Complete |
| ATTN-01 | Phase 4 | Pending |
| ATTN-02 | Phase 4 | Pending |
| ATTN-03 | Phase 4 | Pending |
| LAYOUT-01 | Phase 2 | Complete |
| LAYOUT-02 | Phase 2 | Pending |
| LAYOUT-03 | Phase 2 | Complete |
| LAYOUT-04 | Phase 2 | Pending |
| LAYOUT-05 | Phase 2 | Complete |
| LAYOUT-06 | Phase 2 | Pending |
| LAYOUT-07 | Phase 2 | Pending |
| LAYOUT-08 | Phase 2 | Complete |
| PROJ-01 | Phase 3 | Pending |
| PROJ-02 | Phase 3 | Pending |
| PROJ-03 | Phase 3 | Pending |
| PERS-01 | Phase 4 | Pending |
| PERS-02 | Phase 4 | Pending |
| PERS-03 | Phase 4 | Pending |
| INFRA-01 | Phase 1 | Complete (01-01) |
| INFRA-02 | Phase 1 | Complete (01-01) |
| INFRA-03 | Phase 1 | Complete (01-02) |
| INFRA-04 | Phase 1 | Complete (01-01) |
| INFRA-05 | Phase 1 | Complete (01-01) |

**Coverage:**
- v1 requirements: 31 total
- Mapped to phases: 31
- Unmapped: 0

---
*Requirements defined: 2026-03-14*
*Last updated: 2026-03-14 after plan 01-02 — INFRA-03, TERM-01, TERM-02 complete*
