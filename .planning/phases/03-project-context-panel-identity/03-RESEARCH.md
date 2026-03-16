# Phase 3: Project Context + Panel Identity - Research

**Researched:** 2026-03-16
**Domain:** Electron dialog API, Node.js fs/readdir, Zustand project state, React recursive file tree
**Confidence:** HIGH

## Summary

Phase 3 adds three things: a native folder picker on first launch, a left sidebar file tree, and project-aware cwd for new terminal panels. The panel rename (double-click to edit) is already complete as LAYOUT-06 from Phase 2 — PanelHeader.tsx already handles this fully. The Phase 3 success criterion "User can double-click a panel header to rename it" is therefore already satisfied; the work to be done is folder picking (PROJ-01), file tree sidebar display (PROJ-02), and lazy expand/collapse of that tree (PROJ-03).

All new filesystem operations run exclusively in the main process, following the established pattern from `ptyManager.ts`. Two new IPC channels are needed: `folder:open` (triggers `dialog.showOpenDialog`) and `folder:readdir` (calls `fs.readdir` with `withFileTypes: true` to return name + isDirectory per entry). The renderer stores the opened folder path in a new Zustand store slice and passes it as `cwd` to `TerminalPanel`. The sidebar is a hand-written recursive React component — no external library is needed for a read-only file tree of this scope.

The most significant integration points are: (1) `dialog.showOpenDialog` must be called from the main process via IPC — it cannot be invoked from the renderer directly with contextIsolation enabled; (2) the cwd must flow from the project folder store through `MosaicLayout` → `PanelWindow` → `TerminalPanel.cwd` — currently hardcoded to `"."`, and this is the only Phase 2 code path that needs updating; (3) lazy loading (read only expanded directories) is required for performance on large repos — don't eagerly read the entire tree on folder open.

**Primary recommendation:** Add `folderOpen` and `folderReaddir` methods to the existing `electronAPI` contextBridge, register handlers in a new `src/main/folderManager.ts` file following the `ptyManager.ts` pattern, create a minimal `useProjectStore` Zustand slice for the opened folder path, build a `FileTree.tsx` recursive component with per-node open/closed state, and inject the project path as `cwd` into each `TerminalPanel`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROJ-01 | On launch, if no folder is loaded, a native folder picker dialog opens | `dialog.showOpenDialog({ properties: ['openDirectory'] })` from main process via IPC; trigger from renderer via `window.electronAPI.folderOpen()` on mount when no folder in store |
| PROJ-02 | Left sidebar displays a file tree of the opened project folder | `folder:readdir` IPC handler using `fs.promises.readdir(path, { withFileTypes: true })`; React `FileTree.tsx` recursive component; sidebar fixed-width column alongside mosaic canvas |
| PROJ-03 | File tree supports expand/collapse of directories | Per-node `Set<string>` open state in `FileTree.tsx`; lazy: only call `folder:readdir` when a directory is first expanded; never eagerly load entire tree |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron `dialog` | built-in (Electron 39.x) | Native folder picker OS dialog | Only option that gives real native dialog; no npm package needed |
| Node.js `fs/promises` | built-in (Node 22.x) | Async directory reading | Already used in main process; `readdir` + `withFileTypes` is the idiomatic API |
| Zustand | 5.0.11 (already installed) | Project folder path store slice | Already in project; add `useProjectStore` beside `usePanelStore` |
| React (useState + useEffect) | 19.2.1 (already installed) | File tree component state | No external library needed for a read-only collapsible list |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `path.join` / `path.basename` | built-in (Node) | Path manipulation in main process | Concatenating parent path + entry name for recursive readdir calls |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written FileTree | `react-arborist`, `rc-tree`, MUI TreeView | External libs add 50-200KB, bring their own theming; a read-only display tree is ~80 lines of React — not worth the dependency |
| `fs/promises.readdir` | `fs.readdirSync` | Sync blocks the main process event loop; always use async in ipcMain handlers |
| Single `folder:readdir` IPC for full tree | Recursive IPC per expand | Recursive eager load is catastrophic on node_modules (100k+ files); lazy per-expand is correct |

**Installation:**

No new packages required. All APIs are built-in to Electron and Node.js.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── main/
│   ├── index.ts              # Add registerFolderHandlers() call
│   ├── ptyManager.ts         # Existing — no changes needed
│   └── folderManager.ts      # NEW: folder:open and folder:readdir IPC handlers
├── preload/
│   ├── index.ts              # Add folderOpen and folderReaddir to contextBridge
│   └── index.d.ts            # Add type declarations
└── renderer/src/
    ├── store/
    │   ├── panelStore.ts      # Existing — no changes needed
    │   └── projectStore.ts   # NEW: useProjectStore with folderPath state
    ├── components/
    │   ├── MosaicLayout.tsx   # MODIFY: read folderPath from store, pass as cwd to PanelWindow
    │   ├── PanelWindow.tsx    # MODIFY: accept cwd prop, pass to TerminalPanel
    │   ├── FileTree.tsx       # NEW: recursive sidebar tree component
    │   └── Sidebar.tsx        # NEW: thin wrapper with fixed-width + overflow-y scroll
    └── App.tsx                # MODIFY: horizontal flex layout (sidebar + mosaic)
```

### Pattern 1: FolderService IPC Handler (folderManager.ts)

**What:** Register two IPC handlers following the `ptyManager.ts` pattern. `folder:open` shows the native dialog and returns the selected path (or null if canceled). `folder:readdir` reads one directory level and returns a sorted array of `{ name, isDir }` entries.

**When to use:** Always in main process for any filesystem operation.

```typescript
// Source: Electron dialog docs + Node.js fs/promises docs + ptyManager.ts pattern
import { ipcMain, dialog } from 'electron'
import { readdir } from 'fs/promises'
import { join } from 'path'

export function registerFolderHandlers(): void {
  ipcMain.handle('folder:open', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('folder:readdir', async (_event, dirPath: string) => {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => {
        // Directories first, then alphabetical
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  })
}
```

### Pattern 2: contextBridge Extension

**What:** Add `folderOpen` and `folderReaddir` to the existing `electronAPI` bridge. Follow the same `ipcRenderer.invoke` pattern used for all PTY calls.

```typescript
// Source: preload/index.ts existing pattern
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing pty* methods ...
  folderOpen: (): Promise<string | null> =>
    ipcRenderer.invoke('folder:open'),
  folderReaddir: (
    dirPath: string
  ): Promise<Array<{ name: string; isDir: boolean }>> =>
    ipcRenderer.invoke('folder:readdir', dirPath)
})
```

Type declaration update in `index.d.ts` and `env.d.ts`:
```typescript
folderOpen: () => Promise<string | null>
folderReaddir: (dirPath: string) => Promise<Array<{ name: string; isDir: boolean }>>
```

### Pattern 3: useProjectStore (Zustand)

**What:** A minimal store with a single `folderPath: string | null` field. Components read `folderPath`; `MosaicLayout` passes it to `TerminalPanel` as `cwd`. The store is set once when `folderOpen` resolves.

```typescript
// Source: Zustand docs + panelStore.ts existing pattern
import { create } from 'zustand'

interface ProjectStore {
  folderPath: string | null
  setFolderPath: (path: string) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  folderPath: null,
  setFolderPath: (path) => set({ folderPath: path })
}))
```

### Pattern 4: Folder Picker on First Launch

**What:** In `App.tsx` (or `MosaicLayout.tsx`), call `folderOpen` inside a `useEffect` when `folderPath` is `null`. The effect runs once on mount. After the user picks a folder, store it in `useProjectStore` and render the UI. While `folderPath` is null, render a loading/waiting state.

```typescript
// Source: React useEffect pattern + Electron dialog docs
useEffect(() => {
  if (folderPath !== null) return
  window.electronAPI.folderOpen().then((selected) => {
    if (selected) setFolderPath(selected)
    // If user cancels (selected === null), leave folderPath null.
    // UI can offer a "Pick folder" button as fallback.
  })
}, []) // empty deps — run once on mount
```

**Critical:** The dialog should be called without a `BrowserWindow` argument if called from the IPC handler (the handler does not have access to the window reference directly). For a modal experience, pass `win` from `index.ts` via a closure into `registerFolderHandlers`. See Pattern 1 variation below:

```typescript
// Preferred: pass win to registerFolderHandlers so dialog is modal
export function registerFolderHandlers(win: BrowserWindow): void {
  ipcMain.handle('folder:open', async () => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    // ...
  })
}
```

### Pattern 5: Passing cwd Through the Component Tree

**What:** `MosaicLayout` reads `folderPath` from the store and passes it to `PanelWindow` as a `cwd` prop. `PanelWindow` passes it to `TerminalPanel`. This changes `TerminalPanel`'s `cwd` prop from the hardcoded `"."` to the actual project folder.

Current code in `PanelWindow.tsx` line 24:
```typescript
<TerminalPanel sessionId={sessionId} cwd="." />
```

Changed to:
```typescript
<TerminalPanel sessionId={sessionId} cwd={cwd} />
```

`MosaicLayout` renders `PanelWindow` like this:
```typescript
const folderPath = useProjectStore((s) => s.folderPath)
// ...
renderTile={(id, path) => (
  <PanelWindow key={id} sessionId={id} path={path} cwd={folderPath ?? '.'} />
)}
```

### Pattern 6: FileTree Component (Lazy Expand/Collapse)

**What:** A recursive component that renders a list of directory entries. Each entry stores its own expanded/collapsed state. On first expansion of a directory, it calls `folderReaddir` to fetch children. Children are cached in component state (a Map keyed by path) so they don't re-fetch on collapse/re-expand.

```typescript
// Source: React recursive component pattern + fs.readdir docs
interface TreeEntry {
  name: string
  isDir: boolean
}

interface FileTreeNodeProps {
  path: string         // absolute path of this node
  name: string         // display name
  isDir: boolean
  depth: number
}

function FileTreeNode({ path, name, isDir, depth }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<TreeEntry[] | null>(null)

  async function handleToggle() {
    if (!isDir) return
    if (!expanded && children === null) {
      // First expand: fetch children lazily
      const entries = await window.electronAPI.folderReaddir(path)
      setChildren(entries)
    }
    setExpanded((prev) => !prev)
  }

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div
        style={{ cursor: isDir ? 'pointer' : 'default' }}
        onClick={handleToggle}
      >
        {isDir ? (expanded ? '▾' : '▸') : ' '} {name}
      </div>
      {expanded && children && children.map((child) => (
        <FileTreeNode
          key={child.name}
          path={`${path}/${child.name}`}       // or use path.join
          name={child.name}
          isDir={child.isDir}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}
```

**Top-level FileTree component:**
```typescript
function FileTree({ rootPath }: { rootPath: string }) {
  const [rootEntries, setRootEntries] = useState<TreeEntry[] | null>(null)

  useEffect(() => {
    window.electronAPI.folderReaddir(rootPath).then(setRootEntries)
  }, [rootPath])

  if (!rootEntries) return <div style={{ padding: 8, color: 'var(--fg-secondary)' }}>Loading...</div>

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div style={{ padding: '4px 0', fontSize: 11, color: 'var(--fg-secondary)', paddingLeft: 8 }}>
        {rootPath.split('/').pop()}
      </div>
      {rootEntries.map((entry) => (
        <FileTreeNode
          key={entry.name}
          path={`${rootPath}/${entry.name}`}
          name={entry.name}
          isDir={entry.isDir}
          depth={1}
        />
      ))}
    </div>
  )
}
```

### Pattern 7: Sidebar Layout in App.tsx

**What:** The `App.tsx` currently renders `<MosaicLayout />` full-width. Add a horizontal flex container with a fixed-width sidebar on the left and the mosaic canvas taking the remainder.

```typescript
// Source: CSS flex layout pattern
function App() {
  const folderPath = useProjectStore((s) => s.folderPath)

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', background: 'var(--bg-main)' }}>
      {folderPath && (
        <aside style={{
          width: 220,
          flexShrink: 0,
          background: 'var(--bg-panel)',
          borderRight: '1px solid #3e3e3e',
          overflowY: 'auto'
        }}>
          <FileTree rootPath={folderPath} />
        </aside>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <MosaicLayout />
      </div>
    </div>
  )
}
```

**Critical CSS:** The mosaic container's `flex: 1; min-width: 0` is mandatory — without `min-width: 0` the flex child can overflow its parent on WebKit/Chrome when the terminal inside has a long line.

### Anti-Patterns to Avoid

- **Calling `dialog.showOpenDialog` from the renderer:** Impossible with `contextIsolation: true`. Must go through IPC. The renderer calls `window.electronAPI.folderOpen()` which invokes the handler in main.
- **Eager full tree load on folder open:** A project like this repo has `node_modules` with 100k+ files. Calling `readdir` recursively on open would hang the app. Lazy expand only.
- **Passing `dirPath` through the renderer for concatenation:** Use `path.join` in the main process handler, not string concatenation in the renderer — avoids platform path separator bugs on Windows.
- **Not sorting readdir results:** `fs.readdir` returns entries in filesystem order (essentially random on macOS HFS+). Always sort: directories first, then alphabetical within each group.
- **Using `cwd="."` in TerminalPanel after Phase 3:** The hardcoded `"."` in `PanelWindow.tsx` must be replaced. The ptyManager already resolves relative paths to absolute (via `path.resolve`), but `"."` resolves to the Electron app's working directory, not the user's project folder.
- **Not guarding against null folderPath:** Before Phase 3 is complete, `folderPath` is null on first mount. Both the sidebar render and `cwd` prop fallback must handle `null` gracefully.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native folder selection dialog | Custom HTML `<input type="file">` or file browser UI | `dialog.showOpenDialog` | Only native dialog respects OS conventions, bookmarks, recent paths; HTML input cannot select directories in Electron without hacks |
| Async directory listing | `fs.readdirSync` in IPC handler | `fs.promises.readdir` | Sync blocks the main process event loop; all Node.js I/O in IPC handlers must be async |
| Path concatenation | `${parentPath}/${name}` string template | `require('path').join(parent, name)` | Windows uses `\`, macOS/Linux use `/`; `path.join` is platform-safe |
| File tree state management | Global Redux/Zustand tree state | Local `useState` per node | Tree is UI state only, not shared across components; local state is simpler and avoids store bloat |

**Key insight:** The file tree is display-only (read-only reference per REQUIREMENTS.md "Out of Scope: Built-in text editor — file tree is read-only reference"). No drag-and-drop, no file editing, no file watching. A 100-line recursive React component is the correct scope.

## Common Pitfalls

### Pitfall 1: dialog.showOpenDialog Blocks Until User Responds

**What goes wrong:** The `folder:open` IPC handler returns a Promise that only resolves when the user dismisses the dialog. If the renderer calls `folderOpen()` during app init and then tries to render other things, the UI may appear frozen until the dialog is closed.

**Why it happens:** `dialog.showOpenDialog` is genuinely async — it must wait for user action. In Electron, the dialog appears as a modal sheet (macOS) or separate window, blocking the parent window on macOS when a `BrowserWindow` is passed.

**How to avoid:** Render the app shell first (the `<MosaicLayout>` with zero panels or a loading state), then fire the dialog in a `useEffect` after the renderer has mounted. Do not await the dialog call synchronously in the main process before creating the window.

**Warning signs:** Blank/gray window on launch before the OS dialog appears.

### Pitfall 2: Folder Path Not Passed as cwd to New Panels

**What goes wrong:** New panels added after the initial launch still start in `"."` because only the initial panel reads from the store.

**Why it happens:** The `cwd` is passed as a prop at panel creation time. If `MosaicLayout.handleAddPanel()` does not read the current `folderPath` from `useProjectStore`, new panels get the default `"."`.

**How to avoid:** In `MosaicLayout`, read `folderPath` from `useProjectStore` and pass `folderPath ?? '.'` to every `renderTile` call and to `handleAddPanel`. Because `folderPath` is in Zustand, it is always up-to-date at call time.

**Warning signs:** `pwd` in a newly opened panel shows the Electron app directory instead of the project folder.

### Pitfall 3: fs.readdir Returns Unsorted and Includes Hidden Files

**What goes wrong:** The file tree shows `.git`, `node_modules`, `.DS_Store` mixed randomly with source files, making it noisy and hard to read.

**Why it happens:** `fs.readdir` returns entries in filesystem order (inode order on macOS) and includes all entries including dotfiles. There is no built-in filter.

**How to avoid:** In `folderManager.ts`, sort entries (dirs first, then alpha) and optionally filter dotfiles (names starting with `.`). For v1, filtering is optional — the requirements only say "displays a file tree," not "filters hidden files." But the sort is required for usability.

**Warning signs:** `.git` folder appearing in the middle of the list; entries in random order.

### Pitfall 4: IPC Channel Name Collision With Existing Handlers

**What goes wrong:** If `folder:open` or `folder:readdir` is registered in a separate file but `ipcMain.handle` is called before or after `registerPtyHandlers`, registering the same channel twice causes Electron to throw: "Attempted to register a second handler for 'folder:open'."

**Why it happens:** `ipcMain.handle` is global. Calling `registerPtyHandlers` and `registerFolderHandlers` from `index.ts` in the correct order avoids conflicts, but hot-reload in dev mode can cause double-registration if the module is re-evaluated.

**How to avoid:** Follow the same pattern as `ptyManager.ts` — the handler file exports a `registerXxxHandlers()` function that is called exactly once from `app.whenReady()` in `index.ts`. Do not call `ipcMain.handle` at module top level.

**Warning signs:** Electron console error "Attempted to register a second handler for 'folder:open'" in dev mode after HMR.

### Pitfall 5: FileTree Node Key Collisions on Deep Expand

**What goes wrong:** Rendering `key={entry.name}` at multiple nesting levels causes React key collisions if two different directories contain files with the same name (e.g., two `index.ts` files in different subdirs).

**Why it happens:** React uses `key` only within the same sibling list, so name-only keys are actually fine within a single directory. However, if the full path is not used as the key for the top-level nodes, expanding/collapsing can produce stale renders.

**How to avoid:** Use the full absolute path as the React key: `key={child.path}` (or the constructed path string). This is unique across the entire tree.

**Warning signs:** Expanding a directory shows children from a different directory; collapse/expand causes wrong entries to appear.

### Pitfall 6: `min-width: 0` on Mosaic Flex Child

**What goes wrong:** The terminal panel canvas overflows its flex parent horizontally when xterm renders a line longer than the available width.

**Why it happens:** Flex items have `min-width: auto` by default, which means they can grow beyond their flex basis to accommodate content. Without `min-width: 0`, the flex child does not honor the flex container's size constraint.

**How to avoid:** Always set `style={{ flex: 1, minWidth: 0 }}` on the div that wraps `<MosaicLayout>` in the App sidebar layout.

**Warning signs:** Horizontal scrollbar appears on the entire app when a terminal line is very long.

## Code Examples

Verified patterns from official sources:

### Electron dialog.showOpenDialog (folder picker)
```typescript
// Source: https://www.electronjs.org/docs/latest/api/dialog
import { dialog, BrowserWindow } from 'electron'

const result = await dialog.showOpenDialog(win, {
  properties: ['openDirectory']
})
// result.canceled: boolean
// result.filePaths: string[]  — empty if canceled
if (!result.canceled && result.filePaths.length > 0) {
  return result.filePaths[0]
}
return null
```

### fs/promises readdir with withFileTypes
```typescript
// Source: https://nodejs.org/api/fs.html#fspromisesreaddirpath-options
import { readdir } from 'fs/promises'

const entries = await readdir('/path/to/dir', { withFileTypes: true })
for (const entry of entries) {
  console.log(entry.name)        // "src"
  console.log(entry.isDirectory()) // true or false
  console.log(entry.isFile())     // true or false
}
```

### Zustand store (minimal slice)
```typescript
// Source: zustand.docs.pmnd.rs — same pattern as panelStore.ts
import { create } from 'zustand'

export const useProjectStore = create<{
  folderPath: string | null
  setFolderPath: (p: string) => void
}>((set) => ({
  folderPath: null,
  setFolderPath: (p) => set({ folderPath: p })
}))
```

### contextBridge type declaration update
```typescript
// Additions to index.d.ts and env.d.ts Window.electronAPI interface
folderOpen: () => Promise<string | null>
folderReaddir: (dirPath: string) => Promise<Array<{ name: string; isDir: boolean }>>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `dialog.showOpenDialog` via `remote` module | IPC `ipcMain.handle` + contextBridge invoke | Electron 10 (remote deprecated), 14 (removed by default) | Must use IPC; remote is gone |
| `fs.readdirSync` in renderer (nodeIntegration: true) | `fs.promises.readdir` in main process via IPC | Electron security hardening | nodeIntegration is false in this project; all fs ops must be in main |
| Untyped IPC args | TypeScript-typed IPC via index.d.ts declarations | electron-toolkit pattern | Already established in this project |

**Deprecated/outdated:**
- `remote.dialog` / `require('electron').remote`: removed from Electron 14+. This project uses Electron 39 — do not reference `remote`.
- `fs.readdirSync` in renderer code: impossible with `contextIsolation: true` and `nodeIntegration: false` (existing config in `index.ts`).

## Open Questions

1. **Should the folder picker auto-trigger on launch or wait for user action?**
   - What we know: PROJ-01 says "if no folder is loaded, a native folder picker dialog opens" — implies automatic
   - What's unclear: whether to fire it immediately on mount (before any UI renders) or after a brief UI settle delay
   - Recommendation: Fire in `useEffect` with empty deps on `App.tsx` mount, after the React tree renders. This ensures the window is visible before the modal dialog appears. If the user cancels, show a "Pick folder" button as fallback.

2. **Should `node_modules` and `.git` be filtered from the file tree?**
   - What we know: Requirements say "displays a file tree" — no explicit filter mentioned; "file tree is read-only reference" (REQUIREMENTS.md)
   - What's unclear: Whether a noisy tree with node_modules hurts the UX enough to warrant filtering in v1
   - Recommendation: Filter entries whose name starts with `.` (dotfiles) and skip `node_modules` by default. These are the two categories that add the most noise with zero value for terminal workflows. Document as a hardcoded filter, not a user preference (preferences are v2).

3. **How should `folderPath` be initialized when the app re-launches?**
   - What we know: Phase 4 (PERS-01) handles persistence; Phase 3 does not persist the folder path
   - What's unclear: Whether Phase 3 should remember the last folder across restarts
   - Recommendation: Per the roadmap, Phase 3 does NOT persist. Every launch triggers the folder picker if no folder is loaded (which is always the case on fresh launch, since there is no persistence yet). Persistence is Phase 4's job.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3.x + @testing-library/react 16.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npm test -- tests/main/folderManager.test.ts tests/renderer/FileTree.test.tsx tests/store/projectStore.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-01 | `folder:open` handler calls dialog.showOpenDialog with openDirectory property | unit | `npm test -- tests/main/folderManager.test.ts -t "folder:open"` | ❌ Wave 0 |
| PROJ-01 | `folder:open` returns null when dialog is canceled | unit | `npm test -- tests/main/folderManager.test.ts -t "canceled"` | ❌ Wave 0 |
| PROJ-01 | `folder:open` returns selected path when confirmed | unit | `npm test -- tests/main/folderManager.test.ts -t "returns path"` | ❌ Wave 0 |
| PROJ-02 | `folder:readdir` handler returns sorted name+isDir entries | unit | `npm test -- tests/main/folderManager.test.ts -t "folder:readdir"` | ❌ Wave 0 |
| PROJ-02 | FileTree component renders root entries from folderReaddir | unit | `npm test -- tests/renderer/FileTree.test.tsx -t "renders entries"` | ❌ Wave 0 |
| PROJ-03 | Clicking a directory entry toggles expanded state | unit | `npm test -- tests/renderer/FileTree.test.tsx -t "expand directory"` | ❌ Wave 0 |
| PROJ-03 | Children are fetched lazily on first expand (folderReaddir called once) | unit | `npm test -- tests/renderer/FileTree.test.tsx -t "lazy load"` | ❌ Wave 0 |
| PROJ-03 | Collapsing and re-expanding does not re-fetch (children cached) | unit | `npm test -- tests/renderer/FileTree.test.tsx -t "cache"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- tests/main/folderManager.test.ts tests/renderer/FileTree.test.tsx tests/store/projectStore.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/main/folderManager.test.ts` — covers PROJ-01, PROJ-02 (IPC handler unit tests using capturedHandlers dict pattern from ptyManager.test.ts)
- [ ] `tests/renderer/FileTree.test.tsx` — covers PROJ-02, PROJ-03 (React component with mocked `window.electronAPI.folderReaddir`)
- [ ] `tests/store/projectStore.test.ts` — covers `useProjectStore.setFolderPath` action
- [ ] No new framework install needed — vitest + @testing-library/react already installed

## Sources

### Primary (HIGH confidence)
- [Electron dialog docs](https://www.electronjs.org/docs/latest/api/dialog) — `showOpenDialog` signature, `properties: ['openDirectory']`, Promise return shape, `canceled` + `filePaths` fields (fetched 2026-03-16)
- [Node.js fs/promises readdir docs](https://nodejs.org/api/fs.html#fspromisesreaddirpath-options) — `withFileTypes: true`, `Dirent` object, `isDirectory()` / `isFile()` methods (fetched 2026-03-16)
- Project source files read directly — `src/main/ptyManager.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/src/store/panelStore.ts`, `src/renderer/src/components/PanelWindow.tsx`, `src/renderer/src/App.tsx`, `package.json`

### Secondary (MEDIUM confidence)
- [Electron GitHub issue #48217](https://github.com/electron/electron/issues/48217) — `openDirectory` dialog shows file picker on Electron 37+ **Linux only** (Ubuntu 20.04 EoL); closed as not planned; **macOS unaffected** (cross-verified: issue is Linux/GTK-specific, this project targets macOS primarily)
- Phase 2 RESEARCH.md and SUMMARY.md (project files) — confirmed react-mosaic v7.0.0-beta0 is installed (not v6.1.1 as the research assumed); confirmed dual-context API for `MosaicWindowContext` / `MosaicContext`; confirmed `vi.hoisted()` pattern for Vitest mock factories

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs are Node.js/Electron built-ins with stable official docs; Zustand and React are already installed and patterns are proven in Phases 1-2
- Architecture: HIGH — IPC handler pattern is a direct extension of the existing `ptyManager.ts` structure; file tree is straightforward recursive React; no new dependencies
- Pitfalls: HIGH — `min-width: 0` flex bug and lazy-load imperative are well-known; double-registration and path separator issues are verified from Electron and Node.js docs

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (all APIs are stable built-ins; no fast-moving dependencies introduced in this phase)
