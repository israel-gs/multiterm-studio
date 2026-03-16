# Phase 4: Attention Detection + Persistence - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Two capabilities: (1) an output watcher in the main process that detects when a terminal PTY needs user input, surfacing a pulsing badge on the panel header and a native OS notification when the app is backgrounded; (2) per-project layout persistence that auto-saves the mosaic tree, panel titles, and colors to the project folder, restoring them when the same project is reopened.

</domain>

<decisions>
## Implementation Decisions

### Attention detection patterns
- Conservative detection only — high-confidence patterns: explicit prompts like `? `, `(y/N)`, `Do you want`, `[Y/n]`
- No moderate/aggressive heuristics (line-ending `> `, ANSI pause sequences) — false positives degrade trust
- 5-second cooldown per panel between attention events — prevents badge/notification spam from rapid-fire prompts (e.g., `npm init`)
- Detection runs continuously on all PTY output; badge only appears when the panel is NOT focused
- Native notification only fires when the app is backgrounded
- Global detection only — no per-panel toggle in v1

### Badge appearance
- Small pulsing dot overlaid on the existing color dot in PanelHeader (absolute-positioned CSS)
- Badge clears when the panel receives focus (click/keyboard focus)
- No text badge or header glow — minimal UI addition reusing existing element

### Native notification behavior
- Notification includes panel title + output snippet (e.g., "Terminal (build): Do you want to continue? (y/N)")
- Clicking the notification brings the Electron window to front AND focuses the specific panel that triggered it
- Only fires when app is backgrounded — no notifications while user is in the app

### Persistence storage location
- Layout saved to `.multiterm/layout.json` inside the project folder
- Auto-add `.multiterm/` to the project's `.gitignore` if one exists and doesn't already include it
- Save scope: MosaicNode tree structure, split percentages, and each panel's title + color — nothing else

### Auto-save behavior
- Debounced save: 1 second after the last layout change (batches rapid drag-resize events)
- Additional save on Electron `before-quit` event to catch final-second changes
- Save triggered by: mosaic tree changes (split, close, resize), title edits, color changes

### Restore experience
- Jump straight into restored layout — no loading screen. Mosaic tree restored immediately, PTY sessions created in parallel
- All restored panels start in the project root cwd (no per-panel cwd tracking)
- If the project folder no longer exists, fall back to folder-picker-on-launch behavior (discard saved layout)
- Corrupted or unparseable layout.json treated same as missing — fresh start with folder picker

### Claude's Discretion
- Exact regex patterns for conservative attention detection
- Pulsing animation CSS (speed, color, opacity range)
- layout.json schema and serialization format
- Error handling for filesystem write failures during auto-save
- How to wire notification click → panel focus (IPC channel design)

</decisions>

<specifics>
## Specific Ideas

- Badge should feel subtle but unmissable — a small pulsing dot on the color dot, not an intrusive banner
- Notification content should give enough context to decide whether to switch immediately (panel name + prompt text)
- Layout restore should feel instant — "I closed the app and it came back exactly as I left it"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ptyManager.ts:30` — `ptyProcess.onData()` callback is the exact hook point for attention detection; add pattern matching inline in the data pipeline
- `PanelHeader.tsx:26-31` — existing `.color-dot` element is where the pulsing badge overlays
- `panelStore.ts` (zustand) — `PanelMeta { title, color }` is already the data that needs serialization; extend with `attention: boolean` for badge state
- `projectStore.ts` — `folderPath` is the key for locating `.multiterm/layout.json`
- `MosaicLayout.tsx:16` — `tree` state (MosaicNode<string>) is the layout structure to serialize
- `preload/index.ts` — IPC bridge pattern established; needs new channels for `pty:attention`, `layout:save`, `layout:load`

### Established Patterns
- IPC via contextBridge with unsubscribe closures (preload/index.ts) — attention events use the same push pattern as `pty:data`
- Zustand stores for renderer state (panelStore, projectStore) — persistence layer reads into these on restore
- `handleChange` in MosaicLayout.tsx already diffs tree changes — hook auto-save debounce here

### Integration Points
- `ptyManager.ts` `onData` handler → add attention detection before forwarding to renderer
- `MosaicLayout.handleChange` → trigger debounced layout save
- `panelStore.setTitle` / `panelStore.setColor` → trigger debounced layout save
- `main/index.ts` `app.whenReady` → load saved layout and pass to renderer
- `main/index.ts` `before-quit` → final layout save
- `folderManager.ts` `folder:open` handler → check for `.multiterm/layout.json` and return layout data

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-attention-detection-persistence*
*Context gathered: 2026-03-16*
