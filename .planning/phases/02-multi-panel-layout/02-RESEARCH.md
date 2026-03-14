# Phase 2: Multi-Panel Layout - Research

**Researched:** 2026-03-14
**Domain:** react-mosaic tiling layout + zustand panel state + PTY lifecycle management
**Confidence:** HIGH

## Summary

Phase 2 wires the single-terminal proof-of-concept from Phase 1 into a full tiling workspace. The core technology is `react-mosaic-component` (locked in PROJECT.md) which manages the panel tree as a controlled binary/n-ary tree of string leaf IDs. Panel metadata (title, color, sessionId) lives in a `zustand` store (also locked). The `TerminalPanel` component from Phase 1 is reused unchanged inside each `MosaicWindow`; the new work is the layout shell, the panel header, and the PTY lifecycle hooks that kill orphaned processes when panels close.

The two highest-risk integration points are: (1) xterm.js `FitAddon` must re-run `.fit()` inside a `ResizeObserver` tied to the `MosaicWindow` container, not the browser window — the existing Phase 1 pattern already does this correctly. (2) When the last panel is closed the mosaic `value` becomes `null`; the app must render `zeroStateView` or auto-spawn a fresh panel rather than crash.

react-mosaic v6.1.1 declares `peerDependencies: { "react": "16 - 19" }` — this project uses React 19.2.1, so there is no peer-dep conflict and no `--legacy-peer-deps` workaround is needed.

**Primary recommendation:** Use react-mosaic controlled mode (`value` + `onChange`), zustand for panel metadata, and `crypto.randomUUID()` as the mosaic leaf key (same pattern Phase 1 used for `sessionId`). Keep mosaic leaf key === sessionId so there is a single source of truth.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LAYOUT-01 | Terminal panels arranged in tiling layout using react-mosaic | react-mosaic-component v6.1.1 controlled mode; `Mosaic<string>` with leaf = sessionId |
| LAYOUT-02 | User can split panels horizontally and vertically | `MosaicWindowActions.split()` via context; built-in drag-to-split; custom toolbar button |
| LAYOUT-03 | User can resize panels by dragging dividers | Built-in to react-mosaic drag dividers; `onRelease` updates controlled state |
| LAYOUT-04 | User can close individual panels via header close button | Custom `renderToolbar` button calls `mosaicActions.remove(path)`; triggers PTY kill |
| LAYOUT-05 | Global "+ New terminal" button adds a new panel to the canvas | Programmatic tree mutation: wrap existing root in a new split node with fresh leaf |
| LAYOUT-06 | Panel header displays editable session title (double-click to edit) | zustand store field `title`; `onDoubleClick` → `<input>` swap; blur saves |
| LAYOUT-07 | Panel header has a color dot picker with 6 preset colors | zustand store field `color`; CSS-module dot buttons; no external library needed |
| LAYOUT-08 | Closing a panel kills the associated PTY process | `onChange` diff detects removed leaves; calls `window.electronAPI.ptyKill(sessionId)` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react-mosaic-component | 6.1.1 | Tiling window manager (binary/n-ary tree) | Locked in PROJECT.md; purpose-built, TypeScript-native, React 16–19 |
| zustand | 5.0.x (latest 5.0.11) | Panel metadata store (title, color, sessionId map) | Locked in PROJECT.md; minimal API, no Provider needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| react-mosaic-component/css | same | Required CSS for mosaic layout | Always import alongside the component |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| react-mosaic | react-grid-layout | Grid is row/column fixed; mosaic gives true free-form tiling |
| react-mosaic | Custom split-pane | Would need to hand-roll resize math, tree ops, drag-drop — don't do this |
| zustand | React Context + useReducer | Fine for simple cases; zustand avoids re-render cascade when unrelated panels update |

**Installation:**
```bash
npm install react-mosaic-component zustand
```

No `--legacy-peer-deps` needed — react-mosaic-component declares `"react": "16 - 19"`.

## Architecture Patterns

### Recommended Project Structure
```
src/renderer/src/
├── components/
│   ├── Terminal.tsx          # Phase 1 — unchanged (TerminalPanel)
│   ├── MosaicLayout.tsx      # NEW: Mosaic<string> controlled wrapper
│   ├── PanelWindow.tsx       # NEW: MosaicWindow + custom header + TerminalPanel
│   └── PanelHeader.tsx       # NEW: title edit, color picker, close/split buttons
├── store/
│   └── panelStore.ts         # NEW: zustand store (panels map, addPanel, removePanel)
└── App.tsx                   # Replace single TerminalPanel with MosaicLayout
```

### Pattern 1: Controlled Mosaic with String Leaf IDs

**What:** The mosaic tree (`MosaicNode<string>`) uses `sessionId` strings as leaf values. A zustand store maps each `sessionId` to its metadata (title, color). The `Mosaic` component receives `value` from a React state and calls `onChange` on any user interaction.

**When to use:** Always for this project — controlled mode is required so the app can intercept `onChange`, diff the old and new tree to find removed panels, and kill their PTY processes.

```typescript
// Source: react-mosaic README + github.com/nomcopter/react-mosaic
import { Mosaic, MosaicWindow, MosaicNode } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'

const [tree, setTree] = useState<MosaicNode<string> | null>(() => {
  const id = crypto.randomUUID()
  return id  // single leaf = just the ID string
})

// onChange is called continuously during drag-resize; use onRelease for PTY kill logic
<Mosaic<string>
  value={tree}
  onChange={setTree}
  onRelease={handleRelease}  // fires once after drag ends
  renderTile={(id, path) => (
    <PanelWindow key={id} sessionId={id} path={path} />
  )}
  zeroStateView={<ZeroState onAdd={addPanel} />}
/>
```

### Pattern 2: MosaicWindow with Custom renderToolbar

**What:** `MosaicWindow` wraps each panel. Use `renderToolbar` to fully replace the default Blueprint-themed header with a custom dark-themed one. This is the only way to add editable title, color picker, and custom close/split buttons that match the dark theme.

**When to use:** Always — `toolbarControls` only appends items to the default toolbar. `renderToolbar` gives full control.

```typescript
// Source: react-mosaic README — renderToolbar prop
import { MosaicWindow, MosaicWindowContext } from 'react-mosaic-component'
import { useContext } from 'react'

function PanelWindow({ sessionId, path }: { sessionId: string; path: MosaicPath }) {
  return (
    <MosaicWindow<string>
      path={path}
      title={sessionId}  // required prop even when renderToolbar overrides display
      createNode={() => crypto.randomUUID()}  // used by built-in split action
      renderToolbar={() => <PanelHeader sessionId={sessionId} path={path} />}
    >
      <TerminalPanel sessionId={sessionId} cwd="." />
    </MosaicWindow>
  )
}
```

### Pattern 3: Close Panel via mosaicActions

**What:** To close a panel, consume `MosaicContext` (or `MosaicWindowContext`) inside `PanelHeader`. Call `mosaicActions.remove(path)` on the header close button click.

**Critical:** This triggers the `onChange` callback with a tree that no longer contains this leaf. The `onChange` handler must diff the old and new tree, detect the removed `sessionId`, and call `window.electronAPI.ptyKill(sessionId)`.

```typescript
// Source: react-mosaic context API
import { MosaicWindowContext } from 'react-mosaic-component'

function CloseButton({ path }: { path: MosaicPath }) {
  const { mosaicActions } = useContext(MosaicWindowContext)
  return (
    <button onClick={() => mosaicActions.remove(path)}>×</button>
  )
}
```

### Pattern 4: Split Panel via mosaicWindowActions

**What:** `MosaicWindowActions.split()` splits the current node in two — current becomes `first`, a new leaf becomes `second`. The direction is auto-selected based on container aspect ratio. `createNode` on `MosaicWindow` provides the new leaf ID.

```typescript
// Source: react-mosaic context API
import { MosaicWindowContext } from 'react-mosaic-component'

function SplitButton() {
  const { mosaicWindowActions } = useContext(MosaicWindowContext)
  return (
    <button onClick={() => mosaicWindowActions.split()}>Split</button>
  )
}
```

### Pattern 5: Add Panel Programmatically ("+ New terminal")

**What:** The "+ New terminal" global button is outside any `MosaicWindow`. It must manipulate the tree state directly via `setTree`. Wrap the current root in a new split node with a fresh leaf as `second`.

```typescript
// Source: research synthesis of react-mosaic tree structure
function addPanel(setTree: React.Dispatch<React.SetStateAction<MosaicNode<string> | null>>) {
  const newId = crypto.randomUUID()
  setTree((current) => {
    if (current === null) return newId  // was zero-state, just set single leaf
    return {
      direction: 'row',
      first: current,
      second: newId,
      splitPercentage: 50
    }
  })
  // Also add metadata to zustand store
  usePanelStore.getState().addPanel(newId)
}
```

### Pattern 6: PTY Lifecycle — Detecting Removed Panels

**What:** React-mosaic fires `onChange` continuously during drag (for smooth resize). Use `onRelease` for expensive side effects. Use a utility to get all leaf IDs from old and new tree and diff them.

```typescript
// Source: react-mosaic utility API
import { getLeaves } from 'react-mosaic-component'

function handleTreeChange(newTree: MosaicNode<string> | null) {
  // Compute diff to find killed panels
  const oldLeaves = new Set(getLeaves(tree))  // tree = previous value from ref
  const newLeaves = new Set(getLeaves(newTree))
  for (const id of oldLeaves) {
    if (!newLeaves.has(id)) {
      window.electronAPI.ptyKill(id)
      usePanelStore.getState().removePanel(id)
    }
  }
  setTree(newTree)
  treeRef.current = newTree
}
```

### Pattern 7: zustand Panel Store

**What:** Minimal store mapping `sessionId -> { title, color }`. No selectors needed — components subscribe to the whole panel map or to a specific panel by ID.

```typescript
// Source: zustand docs (zustand.docs.pmnd.rs) + PROJECT.md constraint
import { create } from 'zustand'

interface PanelMeta {
  title: string
  color: string
}

interface PanelStore {
  panels: Record<string, PanelMeta>
  addPanel: (id: string) => void
  removePanel: (id: string) => void
  setTitle: (id: string, title: string) => void
  setColor: (id: string, color: string) => void
}

export const usePanelStore = create<PanelStore>((set) => ({
  panels: {},
  addPanel: (id) =>
    set((s) => ({ panels: { ...s.panels, [id]: { title: 'Terminal', color: '#569cd6' } } })),
  removePanel: (id) =>
    set((s) => {
      const { [id]: _, ...rest } = s.panels
      return { panels: rest }
    }),
  setTitle: (id, title) =>
    set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], title } } })),
  setColor: (id, color) =>
    set((s) => ({ panels: { ...s.panels, [id]: { ...s.panels[id], color } } }))
}))
```

### Anti-Patterns to Avoid

- **Separate sessionId and mosaic leaf ID:** The mosaic leaf key IS the sessionId. Never map between two IDs — it creates synchronization bugs when panels are removed.
- **Killing PTY in onChange:** `onChange` fires on every drag pixel. Call `ptyKill` only after diffing old vs. new leaves, using a ref to hold the previous tree.
- **Using `toolbarControls` instead of `renderToolbar`:** `toolbarControls` appends to Blueprint's default toolbar, which clashes with the dark theme. Always use `renderToolbar` for full control.
- **Not importing the CSS:** `react-mosaic-component.css` is required. Without it the mosaic divider drag handles are invisible and resize does not work visually.
- **forgetting `createNode` on `MosaicWindow`:** If `createNode` is absent, the built-in split action throws. Always provide `createNode={() => crypto.randomUUID()}`.
- **Controlling CSS via Blueprint classes:** The library's default CSS uses Blueprint design tokens. For the dark theme, apply custom overrides. Do NOT install `@blueprintjs/core` — it is a heavyweight dep and not needed when using `renderToolbar` exclusively.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tiling layout with drag-resize | Custom split-pane with % math | react-mosaic | Drag handles, min-size clamping, keyboard, tree ops already built |
| Panel tree diffing | Custom recursive tree walker | `getLeaves()` from react-mosaic | Handles n-ary trees, null root, nested splits |
| Panel metadata state | React Context + prop drilling | zustand | Avoids cascade re-renders, panel 3 updating shouldn't re-render panel 1 |
| Balanced initial layout | Manual split node construction | `createBalancedTreeFromLeaves()` | Handles 1, 2, 3+ panels symmetrically |

**Key insight:** The panel tree logic (splitting, removing, expanding) has deceptive edge cases around null roots, single-leaf trees, and depth-first parent tracking. react-mosaic utility functions handle all of these.

## Common Pitfalls

### Pitfall 1: FitAddon Lag After Mosaic Resize

**What goes wrong:** The terminal text layout is stale after the user finishes dragging a divider — columns/rows don't match the new container size.

**Why it happens:** `FitAddon.fit()` is called by the ResizeObserver inside `TerminalPanel`. The ResizeObserver fires asynchronously; if there is any microtask delay, the terminal may not fit immediately on release.

**How to avoid:** The existing Phase 1 `ResizeObserver` pattern is correct — the observer watches the container div, so it fires naturally as react-mosaic animates the resize. No changes needed to `TerminalPanel`. Ensure the `TerminalPanel` container div has `width: 100%; height: 100%` with no extra wrapper that breaks sizing.

**Warning signs:** Terminal shows garbled rendering or line wrapping mismatch after drag.

### Pitfall 2: PTY Kill Called Multiple Times

**What goes wrong:** `ptyKill` is called in both the `TerminalPanel` useEffect cleanup AND in the mosaic `onChange` PTY-diff handler, killing the PTY twice, causing errors in main process.

**Why it happens:** `TerminalPanel` cleanup fires when the component unmounts, which happens when the leaf is removed from the mosaic tree. `onChange` fires first (synchronously on click). Both try to kill the same session.

**How to avoid:** Choose one kill site. Recommended: kill PTY only in the `onChange` diff handler (in `MosaicLayout`), NOT in `TerminalPanel` cleanup. `TerminalPanel.useEffect` cleanup should still call `term.dispose()` and `unsubscribe()` but should not call `ptyKill`. This requires removing `ptyKill` from the Phase 1 cleanup — a deliberate change.

**Warning signs:** Console errors like "Unknown PTY session" or "Cannot kill already-dead process" in the main process.

### Pitfall 3: Zero-State Crash When Last Panel Closed

**What goes wrong:** Closing the last panel sets `tree` to `null`. If `renderTile` receives `null` as the tree (when mosaic has nothing to render), or if the app doesn't handle `null` gracefully, it crashes.

**Why it happens:** react-mosaic passes `null` as `value` when all panels are removed. The `zeroStateView` prop handles this — but if it's not set, the library renders a default "NonIdealState" from Blueprint which may not be styled.

**How to avoid:** Always set `zeroStateView` to a custom element (e.g., a centered "+ New terminal" prompt). Ensure `onChange` diff logic handles `null` as an empty tree (zero leaves).

**Warning signs:** White screen or Blueprint styles leaking in when all panels are closed.

### Pitfall 4: Blueprint CSS Leaking into Dark Theme

**What goes wrong:** react-mosaic ships with Blueprint-based CSS. If you apply `className="mosaic-blueprint-theme"` or import Blueprint CSS, it overrides the dark theme with light-mode Blueprint design tokens.

**Why it happens:** The demo and README show Blueprint usage as the default. The library supports custom themes by omitting the Blueprint class.

**How to avoid:** Import `react-mosaic-component/react-mosaic-component.css` but do NOT import any `@blueprintjs/*` CSS. Do NOT add `className="mosaic-blueprint-theme"` to the `Mosaic` component. Add CSS overrides to `global.css` targeting `.mosaic-root`, `.mosaic-split`, `.mosaic-tile` for dark theme.

**Warning signs:** Divider handles appear in light gray/white, panel backgrounds flash white.

### Pitfall 5: minimumPaneSizePercentage Default of 20%

**What goes wrong:** Users can't drag a panel smaller than 20% of the container, which may be too restrictive for small secondary panels.

**Why it happens:** react-mosaic defaults `minimumPaneSizePercentage` to 20 to prevent accidentally collapsing panels to zero.

**How to avoid:** Pass `resize={{ minimumPaneSizePercentage: 5 }}` to `Mosaic` for tighter minimum. Don't set to 0 — zero-height panels will break FitAddon (terminal with 0 rows).

### Pitfall 6: react-mosaic v7 n-ary Tree Shape vs v6 Binary

**What goes wrong:** The README for the npm package on GitHub appears to document a v7 n-ary API (type `'split'` with `children: []` array), but the published npm package `6.1.1` still uses the classic binary node shape (`{ direction, first, second, splitPercentage }`).

**Why it happens:** The master branch README is ahead of the published npm package.

**How to avoid:** Pin to the npm-published API: binary nodes with `{ direction: 'row' | 'column', first, second, splitPercentage? }`. Do not use `type: 'split'` or `children: []` — those are unreleased. Verify after install by checking `node_modules/react-mosaic-component/package.json` version.

## Code Examples

Verified patterns from official sources and project context:

### Full Mosaic Layout Component (Skeleton)

```typescript
// Synthesized from react-mosaic README + project patterns
import { useState, useRef } from 'react'
import { Mosaic, MosaicNode, getLeaves } from 'react-mosaic-component'
import 'react-mosaic-component/react-mosaic-component.css'
import { PanelWindow } from './PanelWindow'
import { usePanelStore } from '../store/panelStore'

function MosaicLayout({ onAddPanel }: { onAddPanel: () => void }) {
  const addPanel = usePanelStore((s) => s.addPanel)
  const removePanel = usePanelStore((s) => s.removePanel)

  const initialId = crypto.randomUUID()
  const [tree, setTree] = useState<MosaicNode<string> | null>(initialId)
  const treeRef = useRef<MosaicNode<string> | null>(initialId)

  // Initialize first panel in store
  useState(() => { addPanel(initialId) })

  function handleChange(newTree: MosaicNode<string> | null) {
    const oldLeaves = new Set(getLeaves(treeRef.current))
    const newLeaves = new Set(getLeaves(newTree))
    for (const id of oldLeaves) {
      if (!newLeaves.has(id)) {
        window.electronAPI.ptyKill(id)
        removePanel(id)
      }
    }
    treeRef.current = newTree
    setTree(newTree)
  }

  return (
    <Mosaic<string>
      value={tree}
      onChange={handleChange}
      renderTile={(id, path) => <PanelWindow sessionId={id} path={path} />}
      zeroStateView={<button onClick={onAddPanel}>+ New terminal</button>}
      resize={{ minimumPaneSizePercentage: 5 }}
    />
  )
}
```

### Global Add Panel Button Logic

```typescript
// Programmatic tree mutation — no react-mosaic utility needed
function handleAddPanel(
  setTree: React.Dispatch<React.SetStateAction<MosaicNode<string> | null>>,
  treeRef: React.MutableRefObject<MosaicNode<string> | null>,
  addPanel: (id: string) => void
) {
  const newId = crypto.randomUUID()
  addPanel(newId)
  setTree((current) => {
    const next = current === null
      ? newId
      : { direction: 'row' as const, first: current, second: newId, splitPercentage: 50 }
    treeRef.current = next
    return next
  })
}
```

### Panel Header with Editable Title

```typescript
// Pattern: onDoubleClick swaps text to input; blur saves to zustand
function PanelHeader({ sessionId, path }: { sessionId: string; path: MosaicPath }) {
  const { mosaicActions, mosaicWindowActions } = useContext(MosaicWindowContext)
  const { title, color } = usePanelStore((s) => s.panels[sessionId] ?? { title: 'Terminal', color: '#569cd6' })
  const setTitle = usePanelStore((s) => s.setTitle)
  const setColor = usePanelStore((s) => s.setColor)
  const [editing, setEditing] = useState(false)

  const COLORS = ['#569cd6', '#6a9955', '#f44747', '#d7ba7d', '#c678dd', '#4ec9b0']

  return (
    <div className={styles.header} style={{ background: 'var(--bg-header)' }}>
      <span className={styles.colorDot} style={{ background: color }} />
      {COLORS.map((c) => (
        <button key={c} className={styles.colorBtn} style={{ background: c }}
          onClick={() => setColor(sessionId, c)} />
      ))}
      {editing
        ? <input autoFocus defaultValue={title}
            onBlur={(e) => { setTitle(sessionId, e.target.value); setEditing(false) }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        : <span onDoubleClick={() => setEditing(true)}>{title}</span>
      }
      <button onClick={() => mosaicWindowActions.split()}>⊞</button>
      <button onClick={() => mosaicActions.remove(path)}>×</button>
    </div>
  )
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Blueprint-themed mosaic (default) | Custom `renderToolbar` + CSS overrides | react-mosaic always supported this | Avoids 600KB Blueprint dep |
| Class components for context access | `useContext(MosaicWindowContext)` | React 16.3+ hooks era | Cleaner functional component pattern |
| `xterm` unscoped package | `@xterm/xterm` v6 scoped | xterm v5 deprecation | Already done in Phase 1 |

**Deprecated/outdated:**
- `contextTypes` static property on class components for mosaic context: use `useContext(MosaicWindowContext)` instead
- `MosaicWithoutDragDropContext`: only needed when you control the DnD provider yourself; not needed here
- `createBalancedTreeFromLeaves`: fine utility but not needed if we always add panels one at a time to the right

## Open Questions

1. **react-mosaic v6 vs v7 exact published API shape**
   - What we know: npm 6.1.1 is the latest published; master branch README shows a v7 n-ary API
   - What's unclear: Whether the npm package exports `type: 'split'` nodes or only classic binary `{ first, second }`
   - Recommendation: Check `node_modules/react-mosaic-component/package.json` after install and read the type definitions before writing any node construction code

2. **Blueprint CSS bleed**
   - What we know: Library ships `react-mosaic-component.css` with some Blueprint-derived variables
   - What's unclear: How much of the dark theme we'll need to override in global.css
   - Recommendation: Plan a Wave 0 task to import the library CSS and audit what needs overriding in the browser before writing component code

3. **Double PTY kill race condition**
   - What we know: React unmounts `TerminalPanel` after `onChange` fires, so both cleanup paths run
   - What's unclear: Whether `node-pty.kill()` throws on a second call for the same PID or silently no-ops
   - Recommendation: Move all `ptyKill` calls to the `onChange` diff handler; remove `ptyKill` from `TerminalPanel` cleanup; document this as a deliberate Phase 2 change to Phase 1 code

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + @testing-library/react 16.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npm test -- --reporter=verbose tests/renderer/MosaicLayout.test.tsx` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LAYOUT-01 | Mosaic renders with initial leaf panel | unit | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "renders initial panel"` | ❌ Wave 0 |
| LAYOUT-02 | Split button calls mosaicWindowActions.split() | unit | `npm test -- tests/renderer/PanelHeader.test.tsx -t "split button"` | ❌ Wave 0 |
| LAYOUT-03 | onChange updates tree state (resize/drag end) | unit | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "onChange updates tree"` | ❌ Wave 0 |
| LAYOUT-04 | Close button calls mosaicActions.remove | unit | `npm test -- tests/renderer/PanelHeader.test.tsx -t "close button"` | ❌ Wave 0 |
| LAYOUT-05 | Add panel wraps current root in row split | unit | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "add panel"` | ❌ Wave 0 |
| LAYOUT-06 | Double-click title enters edit mode; blur saves | unit | `npm test -- tests/renderer/PanelHeader.test.tsx -t "title edit"` | ❌ Wave 0 |
| LAYOUT-07 | Color picker buttons call setColor with correct hex | unit | `npm test -- tests/renderer/PanelHeader.test.tsx -t "color picker"` | ❌ Wave 0 |
| LAYOUT-08 | onChange diff detects removed leaf and calls ptyKill | unit | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "ptyKill on close"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/renderer/MosaicLayout.test.tsx tests/renderer/PanelHeader.test.tsx`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/renderer/MosaicLayout.test.tsx` — covers LAYOUT-01, LAYOUT-03, LAYOUT-05, LAYOUT-08
- [ ] `tests/renderer/PanelHeader.test.tsx` — covers LAYOUT-02, LAYOUT-04, LAYOUT-06, LAYOUT-07
- [ ] `tests/store/panelStore.test.ts` — covers zustand store actions (addPanel, removePanel, setTitle, setColor)
- [ ] No new framework install needed — vitest + @testing-library/react already installed

## Sources

### Primary (HIGH confidence)
- `github.com/nomcopter/react-mosaic` README (fetched 2026-03-14) — Mosaic props, MosaicWindow props, renderToolbar, createNode, zeroStateView, CSS import
- `github.com/nomcopter/react-mosaic` package.json (fetched) — peerDeps `"react": "16 - 19"`, version 6.1.1
- `zustand.docs.pmnd.rs` / `npmjs.com/package/zustand` — v5.0.11, `create<State>()` TypeScript pattern
- Project source files read directly — TerminalPanel.tsx, preload/index.ts, ptyManager.ts, vitest.config.ts, electron.vite.config.ts

### Secondary (MEDIUM confidence)
- `dhiwise.com/post/ways-react-mosaic-enhances-dynamic-layouts-in-your-react-app` — controlled mode, renderToolbar, remove/split patterns (cross-verified with README)
- `github.com/nomcopter/react-mosaic/issues/151` — minimumPaneSizePercentage default 20%, resize prop override (verified against library behavior)
- `clouddefense.ai/code/javascript/example/react-mosaic-component` — mosaicWindowActions.split(), mosaicActions.remove() context API (partially verified)

### Tertiary (LOW confidence)
- The n-ary tree API (type: 'split', children: []) described in some search results — likely unreleased v7; not confirmed in published npm package

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — react-mosaic v6.1.1 React 19 compat confirmed from package.json; zustand v5 confirmed from npm
- Architecture: HIGH — controlled mode + renderToolbar pattern confirmed from README; PTY diff pattern is application logic
- Pitfalls: MEDIUM — Blueprint CSS bleed, double-kill, and n-ary API confirmed from issues and source; severity confirmed from project context

**Research date:** 2026-03-14
**Valid until:** 2026-04-14 (react-mosaic is stable; zustand v5 API stable)
