# Multiterm Studio

## What This Is

A cross-platform desktop application that provides a project-scoped multi-terminal workspace. Users open a project folder and get a tiling terminal canvas with file tree sidebar, per-panel color coding, output attention detection, and layout persistence — all tied to the project context. Built with Electron, React, TypeScript, and Vite. Aimed at open source release.

## Core Value

Terminals that are project-aware: every panel inherits the project's working directory, layout and sessions persist per-project, and an output watcher alerts you when a long-running process needs attention.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] File tree sidebar showing the opened project folder
- [ ] Native folder picker dialog on launch if no folder is loaded
- [ ] Multi-panel terminal workspace with tiling layout (react-mosaic)
- [ ] Panels can be split, resized, and closed
- [ ] Each terminal panel uses xterm.js with FitAddon and WebLinksAddon
- [ ] Each panel connected to a real PTY via node-pty
- [ ] Shell session per panel (bash/zsh on macOS/Linux, cmd/powershell on Windows)
- [ ] Panel cwd set to opened project folder
- [ ] Panel header bar with editable session title (double-click to edit)
- [ ] Panel header bar with color dot picker (6 preset colors)
- [ ] Panel header bar with close button
- [ ] Output watcher: detect patterns needing user attention (prompts "?", "> ", "Do you want", ANSI pause sequences)
- [ ] Pulsing badge on panel header when attention detected
- [ ] Native OS notification when attention detected
- [ ] Global "+ New terminal" button to add panels
- [ ] Persist layout and session titles to local JSON config per project
- [ ] Save on change, restore on reopen

### Out of Scope

- Tabs or non-tiling panel layouts — react-mosaic tiling is the only layout model
- Remote/SSH terminal sessions — local PTY only for v1
- Plugin system — keep it focused
- Built-in text editor — this is a terminal tool, not an IDE
- Auto-update mechanism — defer to post-v1

## Context

- Existing terminal apps (iTerm2, Warp, VS Code integrated terminal) don't bind terminals to a project folder with file tree context and per-project persistence
- The output watcher (attention detection) is a differentiating feature — long-running tasks that need input are easy to miss in multi-panel setups
- Target audience: developers who run multiple terminal sessions per project (build watchers, servers, test runners, etc.)
- Open source release planned — needs decent UX, README, and packaging

## Constraints

- **Tech stack**: Electron 28+ with contextIsolation: true, nodeIntegration: false
- **Bundler**: electron-vite (Vite-based, no webpack)
- **Frontend**: React 18 + TypeScript strict mode
- **Terminal**: xterm.js 5.x with FitAddon, WebLinksAddon
- **PTY**: node-pty managed in main process
- **Layout**: react-mosaic for tiling
- **State**: zustand for panel state
- **IPC channels**: pty:create, pty:write, pty:resize, pty:kill, pty:data, pty:attention, folder:open, folder:readdir
- **Styling**: CSS modules, dark theme (#1a1a1a background, #242424 panels, #2e2e2e headers)
- **Security**: All IPC via contextBridge, no direct Node access from renderer

## Key Decisions

| Decision                           | Rationale                                               | Outcome   |
| ---------------------------------- | ------------------------------------------------------- | --------- |
| electron-vite over webpack         | Faster dev builds, simpler config, modern tooling       | — Pending |
| react-mosaic for tiling            | Battle-tested tiling library, good API for split/resize | — Pending |
| node-pty in main process only      | Security: PTY access isolated from renderer via IPC     | — Pending |
| zustand for state                  | Lightweight, no boilerplate, good for panel state       | — Pending |
| CSS modules over styled-components | Simpler, no runtime cost, matches terminal aesthetic    | — Pending |

---

_Last updated: 2026-03-14 after initialization_
