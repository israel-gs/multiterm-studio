# Phase 04 — UI Review

**Audited:** 2026-03-16
**Baseline:** Abstract 6-pillar standards (no UI-SPEC.md present)
**Screenshots:** Not captured (no dev server detected on ports 3000, 5173, 8080)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Actionable labels throughout; one generic fallback "No folder selected" lacks a call-to-action explanation |
| 2. Visuals | 3/4 | All interactive icon-only buttons have aria-labels and titles; attention badge has proper aria-label; color-dot missing focus-visible ring |
| 3. Color | 2/4 | Hardcoded `#3e3e3e` separator appears in two components instead of using the design token `--fg-secondary`; xterm color map (Terminal.tsx) is a justified exception |
| 4. Typography | 3/4 | Four distinct font sizes (11, 12, 13, 14px) in use via inline styles — within the 4-size budget but all expressed as raw numbers rather than a shared constant |
| 5. Spacing | 2/4 | 23 inline style blocks with raw pixel values scattered across 5 components; no shared spacing scale — values of 4, 6, 8, 10, 12, 16 px appear inconsistently |
| 6. Experience Design | 3/4 | Attention badge, cooldown, and layout restore are well-handled; `layoutLoaded` gate prevents flash; no spinner/skeleton during async layout load leaves a blank screen |

**Overall: 16/24**

---

## Top 3 Priority Fixes

1. **Blank screen during layout load** — Users with a saved layout see a fully invisible `<div>` (bg-main fill, no content) for up to an IPC round-trip while `layoutLoad` resolves — `App.tsx:93-103`. On a cold SSD this can be 100–300 ms. Fix: replace the empty div with a minimal skeleton — a single `<div style={{ background: 'var(--bg-main)', width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ color: 'var(--fg-secondary)', fontSize: 12 }}>Restoring workspace…</span></div>` — preserves the flash-prevention gate while giving the user a status signal.

2. **Hardcoded `#3e3e3e` separator color** — `MosaicLayout.tsx:155` (global toolbar bottom border) and `Sidebar.tsx:15` (right border) both use the raw hex `#3e3e3e` instead of `var(--fg-secondary)` (`#808080`) or a new `--border-subtle` token. If the theme ever changes, these two borders will be out of sync. Fix: add `--border-subtle: #3e3e3e` to `global.css` `:root` block and replace both hardcoded values.

3. **Inline spacing values have no shared scale** — 23 inline `style={{}}` blocks across `App.tsx`, `MosaicLayout.tsx`, `FileTree.tsx`, and `PanelWindow.tsx` use raw pixel integers (`4`, `6`, `8`, `10`, `12`, `16`) with no central reference. Duplicate padding definitions exist: `'8px 16px'` appears in both `App.tsx:76` and `MosaicLayout.tsx:132` for visually similar buttons. Fix: extract a `spacing` constant object (`xs: 4, sm: 8, md: 12, lg: 16`) into a shared `src/renderer/src/utils/tokens.ts` and reference it. Alternatively migrate button styles to CSS classes in `global.css` (the pattern already used for `.panel-header-btn`).

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Passing:**
- Split panel button: `title="Split panel"` + `aria-label="Split panel"` — specific and accurate (`PanelHeader.tsx:85-88`)
- Close panel button: `title="Close panel"` + `aria-label="Close panel"` — matches the destructive action (`PanelHeader.tsx:93-97`)
- Color picker buttons: `aria-label={`Set color to ${hex}`}` — functional description (`PanelHeader.tsx:51`)
- Attention badge: `aria-label="Attention needed"` — clear state description (`PanelHeader.tsx:37`)
- Zero-state and add-panel button: `"+ New terminal"` — specific, not generic "Add" (`MosaicLayout.tsx:141, 171`)
- Folder picker button: `"Pick a folder"` — direct imperative (`App.tsx:85`)
- Notification title: `` `Input needed - ${panelTitle}` `` — contextual and actionable (`attentionService.ts:21`)

**Issues:**
- `"No folder selected"` (`App.tsx:70`) is a status description, not a guide. A user who dismisses the native folder picker ends up reading "No folder selected" with a "Pick a folder" button below, but there is no explanation of *why* they need to pick a folder or what the app does. Score impact: -1 from a 4.
- Panel title input has no `aria-label` or `placeholder` (`PanelHeader.tsx:56-70`) — a screen reader will not announce what the field is for when editing begins.

---

### Pillar 2: Visuals (3/4)

**Passing:**
- Clear visual hierarchy in panel headers: color dot (identity) → color swatches (action) → title (label) → split/close (navigation) — left-to-right information priority is correct.
- Attention badge placement as absolute overlay on the color dot is an economical reuse of existing visual real estate — no new DOM structure required.
- `.panel-header-btn:hover { color: var(--fg-primary) }` provides visible hover feedback for icon-only buttons (`global.css:87`).
- Split/close buttons have both `title` tooltip and `aria-label` — passes for both keyboard and pointer users.
- `data-testid` attributes on `color-dot` and `attention-badge` are correctly scoped and not in the user-facing API.

**Issues:**
- `.color-dot` and `.panel-header-btn` have no `focus-visible` ring. When navigating by keyboard, focus is invisible on these elements. The `global.css` reset removes default outlines via `margin: 0` but does not add a custom `:focus-visible` rule. Fix: add `.panel-header-btn:focus-visible, .color-option:focus-visible { outline: 2px solid var(--fg-primary); outline-offset: 2px; }` to `global.css`.
- The "Pick a folder" button (`App.tsx:73-86`) is styled entirely with inline styles and has no `focus-visible` ring either — same root cause.
- The mosaic splitter (resize handle) has no ARIA `role="separator"` attribute — this is a `react-mosaic-component` default and outside this phase's scope, but worth noting.

---

### Pillar 3: Color (2/4)

**Passing:**
- A five-token design system is established in `global.css`: `--bg-main`, `--bg-panel`, `--bg-header`, `--fg-primary`, `--fg-secondary`. Most components use these tokens correctly.
- `base.css` provides a parallel Electron-inherited token set (`--ev-c-*`, `--ev-button-*`) — the two systems coexist without conflict since `global.css` values shadow the `base.css` body background.
- xterm color map in `Terminal.tsx:13-32` uses 19 hardcoded hex values — this is a justified exception because xterm requires a named color scheme as a JS object; these cannot be CSS variables.
- Attention badge color `#f44747` in `main.css:11` matches the red preset in the PRESET_COLORS array — intentionally consistent.

**Issues:**
- `MosaicLayout.tsx:155`: `borderBottom: '1px solid #3e3e3e'` — hardcoded separator color not in the token set.
- `Sidebar.tsx:15`: `borderRight: '1px solid #3e3e3e'` — same hardcoded value, different component.
- `#3e3e3e` is neither `--bg-header` (`#2e2e2e`) nor `--fg-secondary` (`#808080`) — it sits between the two, meaning it was chosen by eye rather than from the token scale. Either introduce `--border-subtle: #3e3e3e` in `global.css` or map it to the closest existing token.
- `PanelHeader.tsx:18`: hardcoded fallback color `'#569cd6'` in the default panel object. This is the default panel color (matching `PRESET_COLORS[0]`), and it's acceptable as a constant rather than a CSS variable, but it ideally lives in a shared `DEFAULT_PANEL_COLOR` constant rather than inline in a fallback object.

---

### Pillar 4: Typography (3/4)

**Passing:**
- Body font defined in `global.css` as system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`) — correct fallback chain.
- `panel-header` uses `font-size: 12px` via CSS class in `global.css:54` — centralized, not duplicated.
- Panel header input inherits `font-size: 12px` from `.panel-header-input` CSS rule — consistent with header text.

**Issues:**
- Four distinct font sizes are used across components via inline styles: `11px` (FileTree.tsx:93 — section heading), `12px` (MosaicLayout.tsx toolbar button), `13px` (FileTree.tsx:42, 107 — file entries), `14px` (App.tsx, MosaicLayout.tsx buttons). This is within the 4-size budget but expressed as raw integer/string literals in inline styles rather than CSS classes or shared constants — making it invisible to a global find-replace.
- No font weight variation is used at all in Phase 04 additions (all text is default weight) — the `base.css` reset sets `font-weight: normal` globally, and none of the new interactive elements use `font-weight: 600` or similar to establish hierarchy between primary and secondary text in the toolbar. The existing `panel-header` title is effectively the same visual weight as the buttons.
- `fontSize: 14` (no units, integer) in `App.tsx:70` — while React inline styles handle unitless numbers as `px`, the mixed convention of `14` vs `'14px'` vs `'12px'` across the codebase is inconsistent.

---

### Pillar 5: Spacing (2/4)

**Passing:**
- `panel-header` spacing is in CSS (`gap: 6px`, `padding: 0 8px`, `height: 28px` — `global.css:50-54`) — a single authoritative definition.
- `color-option` and `color-dot` dimensions are also in CSS — not repeated inline.

**Issues:**
- 23 inline `style={{}}` blocks across 5 files. The same button padding value `'8px 16px'` appears independently in `App.tsx:76` and `MosaicLayout.tsx:132` — two buttons that appear to be the same visual class (primary action button) but are styled in parallel rather than sharing a class.
- The toolbar in `MosaicLayout.tsx` uses `padding: '4px 8px'` (line 153) for the container but `padding: '4px 10px'` (line 162) for the button — the asymmetric horizontal padding is likely unintentional.
- `FileTree.tsx` uses `paddingLeft: depth * 16` (line 41) for tree indentation — this is a dynamic computed value and cannot be a CSS class, but the base unit `16` should be drawn from the spacing scale constant.
- `gap: 12` (unitless integer) in `App.tsx:67` vs `gap: 6px` in `global.css` — mixed conventions create maintenance confusion.

---

### Pillar 6: Experience Design (3/4)

**Passing:**
- Attention badge state: full lifecycle covered — detect → badge on → cooldown (5s) → badge off on click/focus. The `onClick`/`onFocus` handlers on `PanelWindow.tsx:30-31` correctly clear the badge for the specific panel.
- `layoutLoaded` gate in `App.tsx:93` prevents a flash of default single-panel state before the saved layout is applied — a deliberate UX guard that the plan correctly prioritized.
- Layout persistence error states: `loadLayout` returns `null` on missing or corrupted JSON (`layoutManager.ts:59`) and `App.tsx` treats that as a fresh-start signal — graceful degradation confirmed.
- Before-quit flush in `main/index.ts` catches last-second layout changes that the debounce window would miss — covers the edge case.
- Notification fires only when `win.isFocused()` is false (`attentionService.ts:18`) — avoids interrupting active users.

**Issues:**
- During layout load (`layoutLoaded === false`), the app renders an empty `<div>` with only `background: 'var(--bg-main)'` (`App.tsx:93-103`). There is no loading indicator, spinner, or text. On systems where the IPC call takes >150ms (cold disk, slow project folder), the user sees a black screen with no feedback. This is the highest-impact XD issue in Phase 04.
- The "Pick a folder" flow: if the user dismisses the native folder picker, `folderPath` remains `null` and the app renders the "No folder selected" screen indefinitely. There is no way to re-trigger the folder picker from keyboard focus — the button must be clicked. This is acceptable for v1 but adds friction for keyboard-primary users.
- The `handlePickFolder` function (`App.tsx:46-54`) does not set `layoutLoaded = true` when the user cancels (returns `null` from `folderOpen`). This means if a user opens the app, the folder picker fires, they wait, the picker opens, they cancel — `layoutLoaded` stays `false` and `folderPath` stays `null`. The `folderPath === null` branch renders first (before the `!layoutLoaded` check at line 93), so in practice this does not show a blank screen, but the `layoutLoaded` gate logic is asymmetric — the initial `useEffect` sets `layoutLoaded = true` on cancel but `handlePickFolder` does not.

---

## Files Audited

- `src/renderer/src/App.tsx`
- `src/renderer/src/components/PanelHeader.tsx`
- `src/renderer/src/components/PanelWindow.tsx`
- `src/renderer/src/components/MosaicLayout.tsx`
- `src/renderer/src/components/Terminal.tsx`
- `src/renderer/src/components/Sidebar.tsx`
- `src/renderer/src/components/FileTree.tsx`
- `src/renderer/src/assets/main.css`
- `src/renderer/src/assets/global.css`
- `src/renderer/src/assets/base.css`
- `src/main/attentionService.ts`
- `src/main/layoutManager.ts`
- `src/renderer/src/utils/layoutPersistence.ts` (inferred from SUMMARY)
