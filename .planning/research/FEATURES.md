# Feature Research

**Domain:** Multi-terminal tiling desktop app (Electron, project-scoped workspace)
**Researched:** 2026-03-14
**Confidence:** HIGH (verified against iTerm2, Warp, Wave, Tabby, Windows Terminal, community discussions)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Real PTY shell session | Every terminal emulator runs an actual shell — anything less is a toy | MEDIUM | node-pty in main process, IPC to renderer. Already in scope. |
| Split / tile panes | Core of any multi-terminal product. iTerm2, Windows Terminal, Warp, Tabby all do this. Missing = reason to leave. | MEDIUM | react-mosaic handles layout. Horizontal + vertical splits. Already in scope. |
| Panel resize (drag dividers) | Users expect to adjust pane proportions by dragging. Non-resizable splits feel broken. | LOW | react-mosaic provides drag-to-resize out of the box. |
| Panel close | Users expect an X button per pane. Inability to close a pane = confusing. | LOW | Already in scope (header close button). |
| Add new terminal panel | "+" button or shortcut to spawn a new terminal is expected in any multi-terminal app. | LOW | Already in scope (global "+ New terminal" button). |
| cwd set to project folder | Users opening a project-specific terminal expect the shell to start in that project folder — otherwise they type `cd` immediately. | LOW | Already in scope (panel cwd = opened project folder). |
| Copy on selection / paste | All terminal apps support click-to-select + copy, Ctrl+Shift+C / Cmd+C, right-click paste. Missing = immediately noticeable. | LOW | xterm.js handles selection; Electron clipboard API handles copy/paste. |
| Scrollback buffer | All terminal emulators scroll back through output history. Users get frustrated without it. | LOW | xterm.js provides scrollback natively. Configure buffer size (default 1000 lines is too small; 10k+ preferred). |
| ANSI color / 256-color / 24-bit color support | Dev tools (compilers, test runners, docker) emit colored output. Broken color = broken output. | LOW | xterm.js supports 24-bit color out of the box. |
| Unicode and emoji rendering | Modern tools emit Unicode. Broken glyphs break trust in the terminal entirely. | LOW | xterm.js handles Unicode; font selection affects glyph coverage. Use a font like JetBrains Mono or system monospace. |
| Keyboard shortcut support | Ctrl+C, Ctrl+D, arrow keys, tab-completion in shell — raw key passthrough to PTY is expected. | LOW | node-pty + xterm.js handle this. Electron may intercept some shortcuts — requires careful mapping. |
| Terminal resize on panel resize | When a pane is resized, the PTY must receive a SIGWINCH / resize event or tools like vim, less, htop break. | LOW | pty:resize IPC channel already in scope. FitAddon + ResizeObserver drives it. |
| Dark theme / readable default colors | Terminal apps are overwhelmingly dark-themed. A bright-white default looks out of place. | LOW | Already decided: #1a1a1a bg, #242424 panels. CSS modules. |
| Folder / project open on launch | If no project is loaded, users expect a way to open one (native dialog). Blank launch with no context is confusing. | LOW | Already in scope (native folder picker dialog). |
| Session title / label per panel | Distinguishing panels by label (e.g., "server", "tests", "db") is expected in any multi-pane setup. | LOW | Already in scope (editable session title, double-click). |

---

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required to pass the "broken" bar, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Output attention detection with badge | Developers lose track of which panel needs input when running 3+ long-running processes. A pulsing badge answers "which panel is waiting for me?" — no other terminal does this proactively for local PTY. | MEDIUM | Pattern-match PTY output for `?`, `> `, `Do you want`, ANSI pause sequences. Emit pty:attention IPC event. Pulsing CSS animation on panel header. Already in scope. |
| Native OS notification when attention needed | When multiterm-studio is backgrounded and a panel needs input, a system notification brings it back into focus. iTerm2 supports bells/job completion notifications but not interactive-prompt detection. | LOW | Electron's `Notification` API or node-notifier. Already in scope. |
| Per-panel color dot | Visual identity per panel (e.g., "green = dev server, red = tests, blue = db") gives instant spatial orientation in a tiling layout. | LOW | 6 preset colors, header dot picker. Already in scope. |
| Per-project layout and session persistence | Reopening the same project restores your exact pane layout and session titles. Most terminals (iTerm2, Warp) save window state globally — not per-project-folder. Wave Terminal introduced workspaces in v0.10 but they're manual saves. Multiterm ties persistence to the project folder automatically. | MEDIUM | JSON config per project path. Save on change, restore on open. Already in scope. |
| File tree sidebar with project context | Showing the opened project's file tree alongside terminals provides project-context that no built-in terminal has (VS Code is an IDE, not a terminal). Developers can navigate/reference files without leaving the terminal window. | MEDIUM | File tree sidebar with folder expand/collapse. Read-only reference view (not a file editor). IPC: folder:readdir. Already in scope. |
| Launch in project folder from OS | Because multiterm is project-scoped, users can open it directly from a folder context menu or CLI (`multiterm-studio .`). This is a workflow integration no current pure terminal provides without configuration. | LOW | Electron accepts argv paths. Main process reads argv[1] as project path on launch. |
| Single window, no tab sprawl | Multiterm avoids the "15 terminal windows or 30 tabs" problem. The tiling canvas IS the workspace. Simpler mental model than tabbed terminals (Tabby, iTerm2 tabs). | LOW | Design decision: tiling only. React-mosaic enforces this. |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem valuable but introduce complexity disproportionate to their benefit for this v1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| SSH / remote terminal sessions | "Just add SSH!" is one of the first requests any terminal gets. Tabby built its identity on this. | Adds significant complexity: connection management, key auth, host fingerprints, reconnection, SFTP. Triples scope. Distracts from the project-local value proposition. | Explicitly out of scope for v1. Users can `ssh` in a panel normally. Note in README. |
| Plugin system / extension API | Users want extensibility; Hyper and Tabby both have plugin ecosystems. | Plugin API requires stable internal interfaces, versioning, sandboxing, documentation, and community maintenance. Kills velocity and creates breaking-change debt in v1. | Keep internal architecture clean; plugins can be v2+ when the API is stable. |
| Built-in text editor | "Can I edit files in a panel?" — Warp added a file editor in 2.0, VS Code has an integrated terminal. | Multiterm is a terminal tool, not an IDE. A file editor duplicates VS Code and expands scope dramatically. | The file tree is read-only reference. Users use their editor of choice. |
| Tabs alongside tiles | Tabs are a familiar mental model. "Why not have tabs AND tiles?" | Two layout paradigms conflict. react-mosaic tiles are the only layout model — mixing tabs and tiles creates inconsistent UX and doubles layout state complexity. | Tiles-only is a deliberate UX decision. Each panel IS a tab conceptually. |
| AI command assistant | Warp's defining feature is AI. Developers assume modern terminals have this. | AI integration requires cloud API, privacy policy, terms of service, latency, costs, and keeps the tool non-local. Contradicts the "focused, local tool" philosophy. | Open source release targets developers who can use their own AI tools. Note clearly in README. |
| Auto-update mechanism | Users expect apps to update themselves. | electron-updater adds complexity, requires a release server or GitHub Releases + code signing, and has edge cases (macOS notarization, Windows signatures). | v1 ships as manual download. Document auto-update as v2 feature after packaging is proven. |
| Global settings/preferences UI | Users want a settings panel to configure fonts, scrollback, shortcuts. | A preferences window is significant UI work that can be deferred without hurting core value. Premature configuration UI adds maintenance burden. | Ship with sensible defaults. Config can be a JSON file for power users in v1. |
| Built-in tmux / session persistence across reboots | "Make panels survive machine restart" is a natural ask once per-project persistence is known. | True session persistence requires daemonized PTY servers (like iTerm2's session restoration). Dramatically increases complexity, especially cross-platform. | Per-project layout metadata (titles, colors, pane arrangement) persists. Shell session content does not — this is v1 scope. |
| Multiple windows for the same project | Power users want to spread panels across monitors. | Multi-window state sync for the same project JSON config creates race conditions and merge conflicts. | Single window per project. Users can open a second multiterm on a subfolder if needed. |

---

## Feature Dependencies

```
[Folder open (native dialog)]
    └──enables──> [File tree sidebar]
    └──enables──> [Panel cwd = project folder]
                      └──enables──> [Per-project layout persistence]
                                        └──enables──> [Save/restore on open]

[node-pty shell session (per panel)]
    └──requires──> [Panel create / add terminal]
    └──enables──> [PTY resize on panel resize]
    └──enables──> [Output attention detection]
                      └──enables──> [Pulsing badge on panel header]
                      └──enables──> [Native OS notification]

[Panel header bar]
    └──contains──> [Editable session title]
    └──contains──> [Color dot picker]
    └──contains──> [Close button]
    └──contains──> [Attention badge]

[react-mosaic tiling layout]
    └──requires──> [Panel create / add terminal]
    └──enables──> [Panel split / resize / close]

[xterm.js renderer]
    └──requires──> [node-pty PTY session]
    └──requires──> [FitAddon] ──enables──> [PTY resize on panel resize]
    └──requires──> [WebLinksAddon] ──enables──> [Clickable URLs in output]
```

### Dependency Notes

- **Per-project persistence requires folder open:** The project path is the key for the JSON config. Without a project folder, there is nothing to persist to.
- **Attention detection requires shell session:** Pattern matching operates on PTY output data (pty:data events). No PTY = no detection.
- **PTY resize requires FitAddon:** xterm.js FitAddon measures the DOM container and emits dimensions; those dimensions must be forwarded via pty:resize IPC to node-pty. If FitAddon is misconfigured, resizing will silently break vim, htop, etc.
- **Color dot and session title require panel header bar:** These are header-bar controls. Header bar must render before these sub-features are added.
- **Native OS notification enhances attention badge:** Both fire on the same pty:attention event. The badge is the in-app signal; the notification is the background-app signal. They can be built together or sequenced (badge first, notification second).

---

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [ ] Folder open on launch (native dialog) — without a project, the app has no identity
- [ ] File tree sidebar (project folder) — establishes project context visually
- [ ] Multi-panel tiling layout with react-mosaic (split, resize, close) — core of the product
- [ ] Real shell session per panel via node-pty (bash/zsh/cmd/powershell) — without PTY, it's a fake terminal
- [ ] Panel cwd = opened project folder — core value proposition
- [ ] xterm.js renderer with FitAddon, WebLinksAddon — working terminal UX
- [ ] PTY resize on panel resize — without this, vim/htop/less break on resize
- [ ] Panel header: editable title, color dot picker, close button — identification and organization
- [ ] Output attention detection + pulsing badge — differentiating feature, should be in v1
- [ ] Native OS notification on attention — makes attention detection useful when backgrounded
- [ ] Global "+ New terminal" button — add panels dynamically
- [ ] Per-project layout and session title persistence (save on change, restore on open) — sticky project context is the second core differentiating feature

### Add After Validation (v1.x)

Features to add once core is working and user feedback is gathered.

- [ ] Keyboard shortcut to split panel (Cmd+D / Ctrl+D) — once core UX works, add power-user shortcuts
- [ ] Scrollback buffer configuration (expose buffer size setting) — gather feedback on default first
- [ ] Copy-on-selection option — some users want it, others don't; make configurable after launch
- [ ] Right-click context menu (copy, paste, clear) — polish UX after core is validated
- [ ] Launch from CLI / argv project path — power-user workflow once app is published
- [ ] Basic keyboard shortcuts reference (show on ?) — discoverability polish

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Preferences / settings UI — build defaults first, settings UI only when users complain about specific defaults
- [ ] Auto-update mechanism — requires code signing, release server; defer until packaging is proven
- [ ] Plugin / extension API — only after internal APIs are stable
- [ ] SSH / remote sessions — large scope addition; validate local-only is enough first
- [ ] Session content restoration after reboot — requires PTY daemon architecture; validate simpler persistence first
- [ ] Multiple windows for same project — validate single-window workflow first

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Real PTY shell session | HIGH | MEDIUM | P1 |
| Multi-panel tiling (react-mosaic) | HIGH | MEDIUM | P1 |
| Folder open + project cwd | HIGH | LOW | P1 |
| File tree sidebar | HIGH | MEDIUM | P1 |
| Panel header (title, color, close) | HIGH | LOW | P1 |
| Output attention detection + badge | HIGH | MEDIUM | P1 |
| Native OS notification | MEDIUM | LOW | P1 |
| Per-project layout persistence | HIGH | MEDIUM | P1 |
| xterm.js FitAddon + resize | HIGH | LOW | P1 |
| Add new terminal button | HIGH | LOW | P1 |
| Scrollback buffer (default) | MEDIUM | LOW | P1 |
| Copy/paste (selection + shortcuts) | HIGH | LOW | P1 |
| Keyboard shortcuts (split, close) | MEDIUM | LOW | P2 |
| Right-click context menu | MEDIUM | LOW | P2 |
| CLI argv project path | LOW | LOW | P2 |
| Preferences / settings UI | MEDIUM | HIGH | P3 |
| Auto-update | LOW | HIGH | P3 |
| SSH remote sessions | HIGH (requested) | HIGH | P3 |
| Plugin system | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Competitor Feature Analysis

| Feature | iTerm2 | Warp | Wave Terminal | Tabby | Multiterm Studio Approach |
|---------|--------|------|---------------|-------|--------------------------|
| Split panes / tiling | Yes (unlimited) | Yes | Yes (drag-drop blocks) | Yes (nested) | Yes — react-mosaic, tiles only |
| Per-project persistence | No (global profiles) | No (Drive is cloud) | Yes (workspaces, manual save) | No | Yes — automatic, per project path |
| File tree sidebar | No | No (file editor in 2.0) | No (separate preview block) | No | Yes — integrated sidebar |
| Output attention detection | Bells/job completion only | No | No | No | Yes — pattern-match + badge + OS notification |
| Per-panel color coding | Profile-level coloring | Tab accent colors | Tab themes per workspace | Tab colors | Yes — per-panel color dot, 6 presets |
| Project-scoped cwd | No | No | No | No | Yes — all panels start in project folder |
| SSH / remote | No | Warp Drive shared sessions | SSH blocks (experimental) | Yes (core feature) | No — explicitly out of scope v1 |
| AI integration | No | Yes (core, Warp 2.0) | Yes (AI chat block) | No | No — out of scope |
| Plugin system | Yes (scripts, API) | No | No | Yes | No — out of scope v1 |
| Open source | Yes | No | Yes | Yes | Yes — planned |
| Cross-platform | macOS only | macOS, Linux, Windows | macOS, Linux, Windows | macOS, Linux, Windows | Yes — Electron (macOS, Linux, Windows) |

---

## Sources

- [iTerm2 Features](https://iterm2.com/features.html) — split panes, session restoration, notification bells
- [Warp All Features](https://www.warp.dev/all-features) — modern terminal feature taxonomy
- [Wave Terminal](https://github.com/wavetermdev/waveterm) — workspace/project-aware features
- [Tabby Terminal](https://github.com/Eugeny/tabby) — open source cross-platform comparison
- [State of Terminal Emulators 2025](https://www.jeffquast.com/post/state-of-terminal-emulation-2025/) — industry state of the art, missing features
- [Hacker News: State of Terminal Emulators 2025](https://news.ycombinator.com/item?id=45799478) — community pain points
- [Lemmy: What features do you want in a terminal emulator? (2025)](https://lemmy.world/post/23740006) — developer wish list
- [Windows Terminal Panes](https://learn.microsoft.com/en-us/windows/terminal/panes) — pane splitting UX patterns
- [Warp vs iTerm2 Comparison](https://www.warp.dev/compare-terminal-tools/iterm2-vs-warp) — feature comparison
- [Top 8 Terminal Emulators 2026](https://scopir.com/posts/best-terminal-emulators-developers-2026/) — competitive landscape

---
*Feature research for: Multi-terminal tiling desktop app (Electron / multiterm-studio)*
*Researched: 2026-03-14*
