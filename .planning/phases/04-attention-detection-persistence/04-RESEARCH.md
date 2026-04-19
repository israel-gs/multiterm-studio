# Phase 4: Attention Detection + Persistence - Research

**Researched:** 2026-03-16
**Domain:** Electron IPC push events, Node.js filesystem persistence, CSS keyframe animation, PTY output pattern matching
**Confidence:** HIGH

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Attention detection patterns**

- Conservative detection only — high-confidence patterns: explicit prompts like `? `, `(y/N)`, `Do you want`, `[Y/n]`
- No moderate/aggressive heuristics (line-ending `> `, ANSI pause sequences) — false positives degrade trust
- 5-second cooldown per panel between attention events — prevents badge/notification spam from rapid-fire prompts (e.g., `npm init`)
- Detection runs continuously on all PTY output; badge only appears when the panel is NOT focused
- Native notification only fires when the app is backgrounded
- Global detection only — no per-panel toggle in v1

**Badge appearance**

- Small pulsing dot overlaid on the existing color dot in PanelHeader (absolute-positioned CSS)
- Badge clears when the panel receives focus (click/keyboard focus)
- No text badge or header glow — minimal UI addition reusing existing element

**Native notification behavior**

- Notification includes panel title + output snippet (e.g., "Terminal (build): Do you want to continue? (y/N)")
- Clicking the notification brings the Electron window to front AND focuses the specific panel that triggered it
- Only fires when app is backgrounded — no notifications while user is in the app

**Persistence storage location**

- Layout saved to `.multiterm/layout.json` inside the project folder
- Auto-add `.multiterm/` to the project's `.gitignore` if one exists and doesn't already include it
- Save scope: MosaicNode tree structure, split percentages, and each panel's title + color — nothing else

**Auto-save behavior**

- Debounced save: 1 second after the last layout change (batches rapid drag-resize events)
- Additional save on Electron `before-quit` event to catch final-second changes
- Save triggered by: mosaic tree changes (split, close, resize), title edits, color changes

**Restore experience**

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

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                              | Research Support                                                                                                                      |
| ------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ATTN-01 | Main process monitors each PTY's stdout for patterns indicating user attention needed    | `ptyProcess.onData()` in ptyManager.ts is the hook; regex patterns documented in Architecture Patterns section                        |
| ATTN-02 | When attention pattern detected, panel header shows a pulsing badge                      | `panelStore` extended with `attention: boolean`; CSS keyframe animation in Code Examples section                                      |
| ATTN-03 | When attention pattern detected, a native OS notification fires (if app is backgrounded) | Electron `Notification` class with `.on('click')` event; `win.isFocused()` for background check; IPC push to renderer for panel focus |
| PERS-01 | Layout and session metadata saved to local JSON config file per project                  | `fs/promises` write to `.multiterm/layout.json`; `layout.json` schema in Code Examples section                                        |
| PERS-02 | Layout saves automatically on change                                                     | Debounced save wired into `MosaicLayout.handleChange` + store subscriptions + `app.before-quit`; pattern documented                   |
| PERS-03 | Layout restores automatically when reopening the same project folder                     | `folderManager.ts` reads layout on `folder:open`; returns layout data to renderer; renderer restores Mosaic tree and panelStore       |

</phase_requirements>

---

## Summary

Phase 4 adds two independent but architecturally related capabilities on top of the existing PTY + mosaic foundation. Both capabilities involve the main process as the authoritative data layer: the PTY manager gains a pattern-matching pipeline that emits IPC push events, and the folder manager gains read/write responsibility for `.multiterm/layout.json`.

The attention detection path is a one-way reactive pipeline: PTY data → regex match → per-panel cooldown check → IPC push `pty:attention:{id}` to renderer → panelStore sets `attention: true` → PanelHeader renders pulsing badge. Native notifications are a side-effect on the same detection event, conditional on `win.isFocused()` being false. The notification click handler (`n.on('click', ...)`) fires in the main process and uses `webContents.send('panel:focus', id)` to tell the renderer which panel to bring into focus, after calling `win.focus()` to restore the window.

The persistence path is simpler: MosaicLayout and panelStore changes trigger a debounced write function that calls `layoutManager.save(folderPath, layoutData)` in the main process via a new `layout:save` IPC invoke. On `folder:open`, the main process reads and returns any saved layout data; the renderer uses it to initialize the Mosaic tree and panelStore instead of creating a blank panel. The `app.before-quit` event triggers a synchronous final save via `writeFileSync` to catch last-second changes reliably.

**Primary recommendation:** Wire all three trigger points for layout saving (MosaicLayout.handleChange, panelStore subscription, before-quit) through a single debounced `scheduleSave(folderPath, getSnapshot())` function in the renderer — this avoids IPC redundancy and keeps the debounce timer unified.

---

## Standard Stack

### Core

| Library                             | Version                     | Purpose                                         | Why Standard                                              |
| ----------------------------------- | --------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| electron (Notification)             | ^39.2.6 (already installed) | Native OS notifications from main process       | Built-in; no additional dependency needed                 |
| Node.js fs/promises                 | Node built-in               | Async write/read of layout.json                 | Already used in folderManager.ts                          |
| zustand                             | ^5.0.11 (already installed) | panelStore attention state, store subscriptions | Already the state management layer                        |
| react (CSS modules / inline styles) | ^19.2.1 (already installed) | Pulsing badge animation                         | CSS keyframes are sufficient; no animation library needed |

### Supporting

| Library                    | Version  | Purpose                                 | When to Use                                                |
| -------------------------- | -------- | --------------------------------------- | ---------------------------------------------------------- |
| Node.js fs (writeFileSync) | built-in | Synchronous save in before-quit handler | Only for before-quit — async write risks being interrupted |

### Alternatives Considered

| Instead of                   | Could Use              | Tradeoff                                                                                                           |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Custom debounce (setTimeout) | lodash/debounce        | lodash is an unnecessary 70KB+ dependency for a single utility; roll a 5-line debounce                             |
| fs/promises for normal saves | electron-store / lowdb | Adds a dependency for a trivial JSON write; direct fs is sufficient and matches existing folderManager.ts patterns |
| CSS keyframe pulsing dot     | framer-motion pulse    | Overkill for a single status indicator; 300B of CSS does the same thing                                            |

**Installation:** No new packages required. All needed APIs (Electron Notification, Node.js fs, zustand subscriptions) are already in the project.

---

## Architecture Patterns

### Recommended File Structure Changes

```
src/main/
├── ptyManager.ts         # Add attention detection in onData pipeline
├── layoutManager.ts      # NEW: read/write .multiterm/layout.json
├── folderManager.ts      # Extend: return layout data on folder:open
└── index.ts              # Add: before-quit save + notification click handler

src/renderer/src/
├── store/
│   └── panelStore.ts     # Extend PanelMeta with attention:boolean, add setAttention/clearAttention
├── components/
│   ├── PanelHeader.tsx   # Add pulsing badge dot overlay
│   └── MosaicLayout.tsx  # Add debounced layout save trigger + restore from initial data
└── assets/main.css       # Add @keyframes pulse-dot animation

src/preload/index.ts      # Add: onAttention, layoutSave, layoutLoad, onPanelFocus channels
```

### Pattern 1: PTY Attention Detection Pipeline

**What:** In `ptyManager.ts`, the existing `onData` callback is augmented with pattern matching before forwarding to the renderer. A per-session cooldown timestamp map prevents spam.
**When to use:** Fires on every PTY data chunk, so it must be O(1) — one regex `.test()` call, one Map lookup, one conditional.

```typescript
// Source: project ptyManager.ts onData pattern + conservative regex per CONTEXT.md

// Per-session cooldown tracking (outside of any handler, module-level)
const attentionCooldown = new Map<string, number>() // sessionId → last fired timestamp (ms)
const ATTENTION_COOLDOWN_MS = 5_000

// Regex: conservative, high-confidence patterns only (per CONTEXT.md)
const ATTENTION_PATTERN =
  /(\? |[(\[](y\/n|Y\/N|y\/N|N\/y)[)\]]|do you want|press enter to continue|password:|continue\? )/i

ptyProcess.onData((data: string) => {
  // Always forward to renderer first
  webContents.send(`pty:data:${id}`, data)

  // Attention detection
  if (ATTENTION_PATTERN.test(data)) {
    const now = Date.now()
    const lastFired = attentionCooldown.get(id) ?? 0
    if (now - lastFired >= ATTENTION_COOLDOWN_MS) {
      attentionCooldown.set(id, now)
      // Push attention event to renderer (badge)
      webContents.send(`pty:attention`, { id, snippet: data.slice(0, 120).trim() })
    }
  }
})
```

### Pattern 2: Electron Notification (background only)

**What:** In `main/index.ts`, a handler listens on `pty:attention` data and fires a native notification only when `win.isFocused()` is false. The notification's `click` event calls `win.focus()` and sends `panel:focus` IPC to the renderer.
**When to use:** Inside a centralized attention handler that is registered once in `createWindow`.

```typescript
// Source: Electron Notification API docs (electronjs.org/docs/latest/api/notification)
import { Notification, app } from 'electron'

// Called from within createWindow, after webContents is available:
webContents.on('ipc-message', (_event, channel, data) => {
  if (channel !== 'pty:attention') return // Or use a dedicated listener
})

// Better: register a dedicated ipcMain.on channel from the attention service:
function handleAttentionEvent(
  win: BrowserWindow,
  sessionId: string,
  panelTitle: string,
  snippet: string
): void {
  if (!win.isFocused()) {
    const n = new Notification({
      title: `Input needed — ${panelTitle}`,
      body: snippet
    })
    n.on('click', () => {
      win.show() // Unminimize if minimized
      win.focus() // Bring to front
      win.webContents.send('panel:focus', sessionId)
    })
    n.show()
  }
}
```

### Pattern 3: Debounced Auto-Save (renderer-side)

**What:** A module-level debounce wrapper that collects rapid layout changes (drag-resize, title edits) and fires a single IPC invoke after 1 second of silence. The renderer holds the current snapshot; the main process writes it.
**When to use:** Called from MosaicLayout.handleChange and panelStore subscriptions (setTitle, setColor).

```typescript
// Source: MDN setTimeout / Zustand subscribe patterns
// Renderer-side: src/renderer/src/utils/layoutPersistence.ts (new file)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleSave(folderPath: string, snapshot: LayoutSnapshot): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    window.electronAPI.layoutSave(folderPath, snapshot)
    debounceTimer = null
  }, 1_000)
}
```

### Pattern 4: Layout Persistence — Main Process

**What:** New `layoutManager.ts` handles all file I/O for `.multiterm/layout.json`. Uses `fs/promises` for normal saves and `fs.writeFileSync` (synchronous) for the `before-quit` handler.
**When to use:** `layoutManager.save()` called from `layout:save` IPC handler; `layoutManager.load()` called from `folder:open` return path.

```typescript
// Source: Node.js fs/promises docs (nodejs.org/api/fs.html)
import { mkdir, writeFile, readFile } from 'fs/promises'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { existsSync } from 'fs'

const MULTITERM_DIR = '.multiterm'
const LAYOUT_FILE = 'layout.json'

export async function saveLayout(folderPath: string, layout: LayoutSnapshot): Promise<void> {
  try {
    const dir = join(folderPath, MULTITERM_DIR)
    await mkdir(dir, { recursive: true }) // No-op if already exists
    await writeFile(join(dir, LAYOUT_FILE), JSON.stringify(layout, null, 2), 'utf8')
  } catch {
    // Silent fail — layout save is best-effort, never blocks UX
  }
}

// Synchronous variant for before-quit (cannot await in synchronous quit handler)
export function saveLayoutSync(folderPath: string, layout: LayoutSnapshot): void {
  try {
    const dir = join(folderPath, MULTITERM_DIR)
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true })
    }
    writeFileSync(join(dir, LAYOUT_FILE), JSON.stringify(layout, null, 2), 'utf8')
  } catch {
    // Silent fail
  }
}

export async function loadLayout(folderPath: string): Promise<LayoutSnapshot | null> {
  try {
    const content = await readFile(join(folderPath, MULTITERM_DIR, LAYOUT_FILE), 'utf8')
    return JSON.parse(content) as LayoutSnapshot
  } catch {
    return null // Missing or corrupted — treated identically
  }
}
```

### Pattern 5: .gitignore Auto-Add (main process, one-time)

**What:** When saving layout for the first time, check if the project has a `.gitignore` that already includes `.multiterm/`. If not, append it.

```typescript
// Source: Node.js fs/promises docs
import { readFile, appendFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export async function ensureGitignore(folderPath: string): Promise<void> {
  const gitignorePath = join(folderPath, '.gitignore')
  if (!existsSync(gitignorePath)) return // No .gitignore — skip

  try {
    const content = await readFile(gitignorePath, 'utf8')
    if (!content.includes('.multiterm')) {
      await appendFile(gitignorePath, '\n# Multiterm Studio local config\n.multiterm/\n', 'utf8')
    }
  } catch {
    // Best-effort — never block on this
  }
}
```

### Pattern 6: Layout Restore in Renderer

**What:** `MosaicLayout` accepts an optional `initialLayout` prop. If provided (from saved data), it sets the mosaic tree and populates panelStore instead of creating a single blank panel.

```typescript
// Restore is triggered after folder:open returns layout data
// In App.tsx or MosaicLayout:
const [tree, setTree] = useState<MosaicNode<string> | null>(
  savedLayout ? savedLayout.tree : initialIdRef.current
)

useEffect(() => {
  if (savedLayout) {
    // Restore all panels from saved metadata
    savedLayout.panels.forEach(({ id, title, color }) => {
      addPanel(id)
      setTitle(id, title)
      setColor(id, color)
    })
  } else {
    addPanel(initialIdRef.current)
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

### Anti-Patterns to Avoid

- **Sending attention events per data chunk without cooldown:** PTY data arrives in rapid small chunks; without a cooldown, `npm init` would fire 50+ attention events per question. Always apply per-session cooldown.
- **Awaiting layout save in before-quit:** Electron's `before-quit` event does not block the quit; async `writeFile` will be abandoned mid-write. Use `writeFileSync` here.
- **Calling `win.focus()` from renderer via IPC:** The renderer cannot directly focus the native window. Only the main process can call `win.focus()`. The notification click handler is in the main process — correct by design.
- **Storing PTY session content in layout.json:** Only metadata (title, color, tree structure) should be saved. Shell content restoration is explicitly out of scope.
- **Using multiple debounce timers:** One shared timer for all layout changes, not one per trigger source. This is why `scheduleSave` is a module-level singleton.

---

## Don't Hand-Roll

| Problem                          | Don't Build                      | Use Instead                                               | Why                                                                             |
| -------------------------------- | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Attention regex pattern matching | A streaming state machine        | Single `ATTENTION_PATTERN.test(data)` regex               | PTY data arrives as complete lines or chunks; regex test is O(1) and sufficient |
| Debounce                         | A per-component debounce hook    | Module-level debounce singleton in `layoutPersistence.ts` | Multiple trigger sources (mosaic, title, color) must share ONE timer            |
| OS notifications                 | Custom HTML notification overlay | Electron `Notification` class                             | Built-in native; no library needed; cross-platform                              |
| Directory creation before write  | Manual existsSync + mkdir chain  | `mkdir(path, { recursive: true })`                        | Node built-in; idempotent; handles nested paths                                 |
| Layout schema validation         | Custom parser                    | try/catch JSON.parse returning null                       | Any parse failure = treat as missing (per CONTEXT.md)                           |
| Focus tracking for notification  | Complex app state                | `win.isFocused()` from BrowserWindow instance             | Electron provides this natively; no tracking needed                             |

**Key insight:** This phase's complexity comes from wiring, not from algorithms. Every individual operation (regex test, JSON parse, CSS animation, Electron Notification) is a one-liner. The challenge is the integration topology: how events flow from PTY → main → renderer → badge, and how tree/store changes flow from renderer → main → disk.

---

## Common Pitfalls

### Pitfall 1: ANSI Escape Sequences Polluting Pattern Matching

**What goes wrong:** PTY output contains raw ANSI escape codes (e.g., `\x1b[?25l`). A conservative regex accidentally matches fragments of these codes, or the prompt text is split across two `onData` chunks and the regex only sees half.
**Why it happens:** PTY data arrives in variable-sized chunks; a `? ` prompt might arrive as `Do you want to co` in one chunk and `ntinue? (y/N)` in the next.
**How to avoid:** Only test against the conservative patterns that are unambiguous and tend to appear as complete tokens: `\? `, `\(y\/N\)`, `\[Y\/n\]`, `Do you want`. Avoid patterns that could be fragment-matched. The 5-second cooldown absorbs the case where the same prompt arrives across multiple chunks.
**Warning signs:** Badge fires while running `ls` or other non-interactive commands.

### Pitfall 2: `before-quit` Async Write Gets Abandoned

**What goes wrong:** If `saveLayout` is async and called inside `app.on('before-quit', ...)`, Electron may terminate the process before the promise resolves, losing the final layout state.
**Why it happens:** `before-quit` does not await async handlers by default. The app quit sequence proceeds without waiting.
**How to avoid:** Use `writeFileSync` explicitly in the `before-quit` handler. The normal debounced save path uses async `writeFile` (fine). Only the quit-time save uses sync.
**Warning signs:** Layout changes made in the last ~1 second before quit are not restored on next open.

### Pitfall 3: Notification Click Event Not Firing on Windows

**What goes wrong:** On Windows, the Electron `Notification` click event sometimes does not fire when the user clicks the notification.
**Why it happens:** Known Electron issue #18746 — Windows notification click behavior changed with Windows 10 notification center. The notification is queued in Action Center and clicking it from there may not trigger the `click` event.
**How to avoid:** This is a Windows-specific limitation. For macOS (primary target), it works reliably. Document this as a known limitation and accept it for v1. The badge in the panel header always works regardless of notification click behavior.
**Warning signs:** App does not come to front after clicking Windows notification.

### Pitfall 4: panelStore.attention Persists After Panel Receives Focus

**What goes wrong:** If `clearAttention(id)` is not triggered when a panel becomes active/focused, stale attention badges remain after the user has already seen the prompt.
**Why it happens:** The renderer needs a way to know when a specific terminal panel receives focus. React's `onFocus` event on the `PanelWindow`/`Terminal` container does not fire for programmatic focus.
**How to avoid:** In `Terminal.tsx` or `PanelWindow.tsx`, attach an `onFocus` or `onClick` handler on the outer div that calls `clearAttention(sessionId)` via the panelStore.
**Warning signs:** Badge persists after clicking into a terminal that triggered it.

### Pitfall 5: Restoring a Layout Whose Panels Have Different UUIDs

**What goes wrong:** If the restore path creates new UUIDs for panels instead of reusing the saved UUIDs, the panelStore entries (title, color) will not match the mosaic tree nodes.
**Why it happens:** Copy-pasting the existing `crypto.randomUUID()` flow without adapting it for restore.
**How to avoid:** During restore, use the panel IDs from `layout.json` directly as the mosaic leaf values and as the panelStore keys. Never generate new UUIDs for restored panels.
**Warning signs:** All restored panels show "Terminal" and default color regardless of saved titles/colors.

### Pitfall 6: IPC Channel Collision — Attention Push vs. Data Push

**What goes wrong:** The existing pattern is `pty:data:{id}` (per-session channel). If `pty:attention` is implemented as a broadcasted single channel, the renderer needs to parse the payload to know which panel to update — manageable, but must be designed consistently.
**Why it happens:** The existing push pattern uses per-session channels; attention events are aggregated.
**How to avoid:** Use a single `pty:attention` channel with payload `{ id, snippet }` (per CONTEXT.md). In preload, expose `onAttention(callback)` that wraps a single `ipcRenderer.on('pty:attention', ...)` listener — one listener for all panels, dispatched by `id` in the callback.

---

## Code Examples

### layout.json Schema (Claude's Discretion)

```typescript
// src/main/layoutManager.ts — LayoutSnapshot type
export interface PanelEntry {
  id: string // UUID matching mosaic leaf and panelStore key
  title: string
  color: string
}

export interface LayoutSnapshot {
  version: 1 // Schema version for future migrations
  tree: MosaicNode<string> | null // Full react-mosaic tree
  panels: PanelEntry[] // Metadata for each leaf
}
```

Example `layout.json`:

```json
{
  "version": 1,
  "tree": {
    "type": "split",
    "direction": "row",
    "children": ["abc-123", "def-456"],
    "splitPercentages": [50, 50]
  },
  "panels": [
    { "id": "abc-123", "title": "dev server", "color": "#6a9955" },
    { "id": "def-456", "title": "git", "color": "#569cd6" }
  ]
}
```

### Pulsing Badge CSS (Claude's Discretion)

```css
/* src/renderer/src/assets/main.css */
.attention-badge {
  position: absolute;
  top: -2px;
  left: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #f44747;
  animation: pulse-attention 1.2s ease-in-out infinite;
  pointer-events: none;
}

@keyframes pulse-attention {
  0% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.5);
    opacity: 0.5;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Parent element (color-dot span) must have position: relative */
.color-dot {
  position: relative;
  /* ... existing styles ... */
}
```

### PanelHeader badge rendering

```tsx
{
  /* Attention badge — only when attention is true AND panel is not focused */
}
{
  panel.attention && (
    <span className="attention-badge" data-testid="attention-badge" aria-label="Attention needed" />
  )
}
```

### preload/index.ts additions

```typescript
// Main → Renderer: attention push (single channel, all panels)
onAttention: (callback: (id: string, snippet: string) => void): (() => void) => {
  const listener = (_: Electron.IpcRendererEvent, data: { id: string; snippet: string }) =>
    callback(data.id, data.snippet)
  ipcRenderer.on('pty:attention', listener)
  return () => ipcRenderer.removeListener('pty:attention', listener)
},

// Main → Renderer: notification click → focus panel
onPanelFocus: (callback: (id: string) => void): (() => void) => {
  const listener = (_: Electron.IpcRendererEvent, id: string) => callback(id)
  ipcRenderer.on('panel:focus', listener)
  return () => ipcRenderer.removeListener('panel:focus', listener)
},

// Renderer → Main: save layout (invoke)
layoutSave: (folderPath: string, layout: LayoutSnapshot): Promise<void> =>
  ipcRenderer.invoke('layout:save', folderPath, layout),

// Renderer → Main: load layout (invoke, returns null if missing)
layoutLoad: (folderPath: string): Promise<LayoutSnapshot | null> =>
  ipcRenderer.invoke('layout:load', folderPath),
```

### Attention conservative regex (Claude's Discretion)

```typescript
// Conservative only — matches high-confidence interactive prompts
// Covers: inquirer.js, npm init, pip confirm, cargo confirm, git confirm, sudo password
const ATTENTION_PATTERN =
  /(\? $|\(y\/n\)|\[y\/n\]|\(Y\/n\)|\[Y\/n\]|\(y\/N\)|\[y\/N\]|do you want|password:|press enter to continue|confirm\?)/i
```

---

## State of the Art

| Old Approach                                       | Current Approach                                             | When Changed                                               | Impact                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| electron-store for app data                        | Direct fs/promises JSON write                                | Always valid; electron-store adds boot cost for simple use | Faster startup, no additional dependency                                     |
| ipcRenderer.removeListener (broken through bridge) | Closure-captured listener returned as unsubscribe fn         | Established in Phase 1                                     | All new push channels (onAttention, onPanelFocus) MUST use this same pattern |
| Renderer calls win.focus()                         | Main process calls win.focus() in notification click handler | Electron security model                                    | Correct architecture; renderer cannot control native window directly         |

**Deprecated/outdated:**

- `electron-notifications` (npm package): Unmaintained; Electron's built-in `Notification` class is the correct replacement.
- `node-notifier`: External dependency; Electron has native notification support since early versions.

---

## Open Questions

1. **Notification click on Windows**
   - What we know: Issue #18746 documents Windows notification click not always firing. macOS works reliably.
   - What's unclear: Whether Electron 39.x resolved this for Windows 10/11 Action Center.
   - Recommendation: Accept as known limitation for v1 (macOS primary target). Badge in panel header is always reliable regardless.

2. **panelStore subscription for auto-save triggering**
   - What we know: Zustand `store.subscribe()` allows selective subscriptions on slices.
   - What's unclear: Whether subscribing to the full `panels` record and comparing title/color changes is efficient enough, or if dedicated `setTitle`/`setColor` actions should call `scheduleSave` directly.
   - Recommendation: Call `scheduleSave` directly from `setTitle` and `setColor` in panelStore rather than using `subscribe` — this is more explicit and avoids equality-check overhead.

3. **PTY onData chunk boundary for prompt detection**
   - What we know: Prompts can arrive split across two data chunks. Conservative patterns like `(y/N)` are typically compact enough to arrive in one chunk.
   - What's unclear: Edge cases with very slow terminals or heavily buffered PTY sessions.
   - Recommendation: Accept this limitation. The 5-second cooldown means even if a prompt is detected a second late (on the next chunk), the badge appears with minimal delay.

---

## Validation Architecture

### Test Framework

| Property           | Value                                              |
| ------------------ | -------------------------------------------------- |
| Framework          | Vitest 3.x                                         |
| Config file        | `vitest.config.ts` (root)                          |
| Quick run command  | `pnpm test` (runs `vitest run --reporter=verbose`) |
| Full suite command | `pnpm test`                                        |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                             | Test Type | Automated Command                                       | File Exists?                |
| ------- | -------------------------------------------------------------------- | --------- | ------------------------------------------------------- | --------------------------- |
| ATTN-01 | PTY onData regex matches attention patterns                          | unit      | `pnpm test -- tests/main/ptyManager.test.ts`            | ❌ Wave 0 — extend existing |
| ATTN-01 | PTY cooldown prevents repeated events within 5s                      | unit      | `pnpm test -- tests/main/ptyManager.test.ts`            | ❌ Wave 0 — extend existing |
| ATTN-01 | Non-matching data does not emit attention event                      | unit      | `pnpm test -- tests/main/ptyManager.test.ts`            | ❌ Wave 0 — extend existing |
| ATTN-02 | panelStore setAttention/clearAttention update attention field        | unit      | `pnpm test -- tests/store/panelStore.test.ts`           | ❌ Wave 0 — extend existing |
| ATTN-02 | PanelHeader renders attention badge when panel.attention is true     | unit      | `pnpm test -- tests/renderer/PanelHeader.test.tsx`      | ❌ Wave 0 — extend existing |
| ATTN-02 | PanelHeader does NOT render badge when panel.attention is false      | unit      | `pnpm test -- tests/renderer/PanelHeader.test.tsx`      | ❌ Wave 0 — extend existing |
| ATTN-03 | Notification fired when win.isFocused() is false                     | unit      | `pnpm test -- tests/main/attentionService.test.ts`      | ❌ Wave 0 — new file        |
| ATTN-03 | Notification NOT fired when win.isFocused() is true                  | unit      | `pnpm test -- tests/main/attentionService.test.ts`      | ❌ Wave 0 — new file        |
| PERS-01 | layoutManager.saveLayout writes valid JSON to .multiterm/layout.json | unit      | `pnpm test -- tests/main/layoutManager.test.ts`         | ❌ Wave 0 — new file        |
| PERS-01 | layoutManager.loadLayout returns null for missing/corrupted file     | unit      | `pnpm test -- tests/main/layoutManager.test.ts`         | ❌ Wave 0 — new file        |
| PERS-01 | layoutManager.saveLayout creates .multiterm/ dir if missing          | unit      | `pnpm test -- tests/main/layoutManager.test.ts`         | ❌ Wave 0 — new file        |
| PERS-02 | scheduleSave debounces — only one write fires after rapid calls      | unit      | `pnpm test -- tests/renderer/layoutPersistence.test.ts` | ❌ Wave 0 — new file        |
| PERS-03 | MosaicLayout restores tree from saved layout (not blank panel)       | unit      | `pnpm test -- tests/renderer/MosaicLayout.test.tsx`     | ❌ Wave 0 — extend existing |
| PERS-03 | panelStore populated with saved title/color on restore               | unit      | `pnpm test -- tests/store/panelStore.test.ts`           | ❌ Wave 0 — extend existing |

### Sampling Rate

- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/main/attentionService.test.ts` — covers ATTN-03 (Notification mock + isFocused mock)
- [ ] `tests/main/layoutManager.test.ts` — covers PERS-01 (fs/promises mock pattern matching folderManager.test.ts)
- [ ] `tests/renderer/layoutPersistence.test.ts` — covers PERS-02 (fake timers / vi.useFakeTimers for debounce)

Existing tests extend in-place (no new files needed): `tests/main/ptyManager.test.ts`, `tests/store/panelStore.test.ts`, `tests/renderer/PanelHeader.test.tsx`, `tests/renderer/MosaicLayout.test.tsx`.

---

## Sources

### Primary (HIGH confidence)

- Electron Notification API: https://www.electronjs.org/docs/latest/api/notification — events including `click`, constructor options, `.show()`
- Electron BrowserWindow: https://www.electronjs.org/docs/latest/api/browser-window — `isFocused()`, `focus()`, `show()`, `blur`/`focus` events
- Node.js fs/promises: https://nodejs.org/api/fs.html — `mkdir({ recursive: true })`, `writeFile`, `readFile`, `appendFile`
- Electron app events: https://www.electronjs.org/docs/latest/api/app — `before-quit` event
- Project source code (ptyManager.ts, preload/index.ts, panelStore.ts) — established IPC patterns

### Secondary (MEDIUM confidence)

- Electron IPC tutorial: https://www.electronjs.org/docs/latest/tutorial/ipc — push pattern with `webContents.send`
- CSS pulse animation patterns: https://web.dev/articles/animations-examples — transform/opacity for compositor-friendly animation
- Zustand subscribe pattern: https://github.com/pmndrs/zustand/discussions/1179 — debounce with store subscription

### Tertiary (LOW confidence)

- Electron issue #18746 (notification click on Windows): https://github.com/electron/electron/issues/18746 — Windows notification click limitations; unverified in Electron 39.x

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all APIs are built-in (Electron Notification, Node.js fs, existing Zustand/React); verified against official docs
- Architecture: HIGH — integration points are clearly established in existing code; patterns match project conventions
- Pitfalls: HIGH — ANSI chunk-split and before-quit async issues are classic; attention badge clear-on-focus is a predictable omission; UUID reuse during restore is a deducible risk
- Attention regex: MEDIUM — conservative patterns are well-known from pexpect/expect tooling, but real-world validation against npm/pip/cargo prompts is flagged as a known concern in STATE.md

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable Electron + Node.js APIs; nothing fast-moving)
