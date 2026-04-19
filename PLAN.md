# UI Redesign: Infinite Canvas + Modern Sidebar

## Context

The previous implementation replaced mosaic splits with a CSS Grid of fixed-height terminal cards. The reference screenshot shows a fundamentally different paradigm: a **free-form infinite canvas** (like Figma/Miro/react-flow without connectors) where terminal cards float at arbitrary positions, can be dragged anywhere, and resized independently. The sidebar also needs cleanup — emoji icons should be replaced with clean text chevrons matching the reference.

## Design Direction (Frontend Design Guidelines)

**Aesthetic**: Industrial/utilitarian terminal workspace — dark, precise, functional. Not generic.

- **Typography**: `"JetBrains Mono", "SF Mono", "Fira Code", monospace` for the sidebar file tree and headers. Distinctive, developer-focused.
- **Color**: Deep dark palette. `#111` canvas bg, `#1c1c1c` cards, subtle `rgba(255,255,255,0.04)` dot grid. Accent via panel color dots only — no gratuitous color. Sharp borders `rgba(255,255,255,0.06)`.
- **Motion**: Subtle `box-shadow` transition on card hover/focus (0.15s). No bouncy animations. Drag/resize should feel instant and snappy (no transition on position/size during interaction).
- **Spatial composition**: Free-form canvas with generous negative space. Cards float with breathing room. Dot grid provides subtle spatial reference without noise.
- **Depth**: Cards use layered shadows (`0 2px 12px rgba(0,0,0,0.5)`) that deepen on hover. Active/dragging card gets elevated shadow. Z-index stacking creates natural depth.
- **Details**: Resize handles invisible until card hover. Grab cursor on header. Subtle card border glow on focus. Canvas dot grid fades to nothing — barely perceptible.

---

## Data Model

### CardRect (per-card position/size)

```typescript
interface CardRect {
  x: number // px from canvas origin
  y: number // px from canvas origin
  w: number // px width
  h: number // px height
  z: number // stacking order (higher = on top)
}
```

### Layout v3 format (extends v2 with positions)

```typescript
interface LayoutSnapshotV3 {
  version: 3
  panelIds: string[]
  panels: Array<{ id: string; title: string; color: string }>
  positions: Record<string, CardRect>
}
```

Migration chain: v1 (mosaic tree) → v2 (flat array) → v3 (flat array + positions). v2 layouts get auto-cascaded positions on load.

### Constants

```
DEFAULT_CARD_W = 480, DEFAULT_CARD_H = 320
MIN_CARD_W = 300, MIN_CARD_H = 200
CASCADE_OFFSET = 30, CANVAS_PADDING = 200
```

---

## Component Architecture

### Create

| File                                             | Purpose                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/TerminalCanvas.tsx` | Replaces `TerminalGrid.tsx`. Owns `panelIds[]`, `positions: Record<string, CardRect>`, `topZ` counter. Scrollable viewport + dot-grid surface + floating cards + toolbar. |
| `src/renderer/src/components/FloatingCard.tsx`   | Absolute-positioned wrapper around `TerminalCard`. Handles drag (via header mousedown), resize (via edge/corner handles), z-index bring-to-front on click.                |

### Modify

| File                                         | Changes                                                                                                                                            |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/App.tsx`                   | Import `TerminalCanvas` instead of `TerminalGrid`                                                                                                  |
| `src/renderer/src/components/CardHeader.tsx` | Add `data-drag-handle` attr to `.panel-header` div. Add `cursor: grab` via CSS.                                                                    |
| `src/renderer/src/components/FileTree.tsx`   | Replace emoji icons (`📂📁📄`) with text chevrons (`▸`/`▾`/space). Remove trailing `.file-tree-arrow` span (redundant with leading chevron).       |
| `src/renderer/src/assets/global.css`         | Remove grid CSS. Add canvas/floating-card/resize-handle/dot-grid styles. Change `.terminal-card` from fixed height to `height: 100%; width: 100%`. |
| `src/main/layoutManager.ts`                  | Add `LayoutSnapshotV3` type, `migrateV2toV3()`, update `loadLayout()` migration chain.                                                             |

### Delete

| File                                           | Reason                           |
| ---------------------------------------------- | -------------------------------- |
| `src/renderer/src/components/TerminalGrid.tsx` | Replaced by `TerminalCanvas.tsx` |

### Unchanged

`Terminal.tsx`, `TerminalCard.tsx`, `panelStore.ts`, `projectStore.ts`, `layoutPersistence.ts`, `preload/index.ts`, `main/index.ts`

---

## Canvas Implementation (`TerminalCanvas.tsx`)

**Structure:**

```
<div className="terminal-canvas-toolbar">     // sticky toolbar
  <button>+ New terminal</button>
</div>
<div className="terminal-canvas-viewport">     // overflow:auto, native scroll
  <div className="terminal-canvas-surface"     // position:relative, dot grid bg
       style={{ width: surfaceW, height: surfaceH }}>
    {panelIds.map(id => <FloatingCard key={id} rect={positions[id]} ... />)}
  </div>
</div>
```

**Surface auto-sizing:** `surfaceW = max(viewportW, maxCardRight + CANVAS_PADDING)`, `surfaceH = max(viewportH, maxCardBottom + CANVAS_PADDING)`. Recalculated on position changes.

**Dot grid background (CSS only):**

```css
background-image: radial-gradient(circle, rgba(255, 255, 255, 0.06) 1px, transparent 1px);
background-size: 24px 24px;
```

**State:** `panelIds[]` + `positions: Record<string, CardRect>` via useState/useRef. Position data is local to canvas (not in panelStore). Merged into layout snapshot at save time.

**Panel lifecycle:** Ported from existing `TerminalGrid.tsx` — addPanel, closePanel, panelStore subscription, buildSnapshot. New: positions included in snapshot.

---

## Drag Implementation

**On `FloatingCard`:** mousedown handler checks `e.target.closest('[data-drag-handle]')` exists and `e.target.closest('button, input')` does not. If valid:

1. Record `startX/Y = e.clientX/Y` and starting card position
2. Attach `mousemove`/`mouseup` to `document` (handles fast mouse leaving element)
3. mousemove: `onMove(id, startCardX + dx, startCardY + dy)` — updates canvas position state
4. mouseup: remove listeners, `scheduleSave`

**xterm.js protection:** During drag, toggle `.terminal-canvas-surface--dragging` class which sets `pointer-events: none` on all `.terminal-card-body` elements. Prevents xterm from stealing mouse events.

---

## Resize Implementation

**Three handles on `FloatingCard`:**

- **SE corner** (12×12px): `cursor: nwse-resize` — adjusts width + height
- **E edge** (6px strip): `cursor: ew-resize` — adjusts width only
- **S edge** (6px strip): `cursor: ns-resize` — adjusts height only

Same mousedown/mousemove/mouseup pattern as drag. Clamped to MIN_CARD_W/MIN_CARD_H. xterm.js ResizeObserver in `Terminal.tsx` auto-fits after resize — no changes needed there.

---

## Z-Index Management

`topZRef = useRef(initialMaxZ)`. On card mousedown: `topZ += 1`, update card's `z` in positions. Monotonically increasing (CSS z-index handles up to 2^31).

---

## Auto-Placement for New Cards

Cascade from last-added card: `{ x: lastCard.x + 30, y: lastCard.y + 30 }`. If no cards exist: `{ x: 50, y: 50 }`. Default size: `DEFAULT_CARD_W × DEFAULT_CARD_H`.

---

## Execution Steps

### Step 1: Layout persistence v3

- `src/main/layoutManager.ts` — add `LayoutSnapshotV3`, `migrateV2toV3()`, update `loadLayout()` chain
- `tests/main/layoutManager.test.ts` — add v2→v3 migration test

### Step 2: FloatingCard + TerminalCanvas

- Create `FloatingCard.tsx` — absolute positioning, drag logic (inline), resize handles + logic (inline), z-index bring-to-front
- Create `TerminalCanvas.tsx` — port panel lifecycle from TerminalGrid, add position state, auto-placement, surface sizing, dot grid

### Step 3: Wire into App.tsx

- Replace `TerminalGrid` import with `TerminalCanvas`

### Step 4: CSS overhaul

- `global.css` — remove grid rules, add canvas/floating-card/resize-handle/dot-grid styles, change `.terminal-card` to `height/width: 100%`, add `cursor: grab` to `.panel-header`

### Step 5: CardHeader + FileTree cleanup

- `CardHeader.tsx` — add `data-drag-handle` to header div
- `FileTree.tsx` — replace emoji icons with `▸`/`▾`/space, remove trailing arrow span

### Step 6: Delete TerminalGrid.tsx

### Step 7: Update tests

- Replace `TerminalGrid.test.tsx` with `TerminalCanvas.test.tsx`
- Verify all 116 existing tests pass

---

## Verification

1. `pnpm build` — no errors
2. `pnpm test` — all tests pass
3. `pnpm dev` — app opens, sidebar shows file tree with chevrons (no emojis), item counts, dates
4. Terminal canvas shows dot grid background
5. Click "+ New terminal" — card appears at cascaded position
6. Drag card by title bar — card moves freely on canvas
7. Resize card by dragging SE corner / E edge / S edge — terminal re-fits
8. Click a card — brings to front (z-index)
9. Scroll canvas — viewport pans to reveal off-screen cards
10. Close card (×) — PTY killed, card removed
11. Close + reopen app — all card positions/sizes restored
