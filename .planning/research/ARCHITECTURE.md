# Architecture Research

**Domain:** Electron desktop terminal app (multi-panel, project-scoped)
**Researched:** 2026-03-14
**Confidence:** HIGH — Electron IPC/contextBridge patterns are well-documented by the Electron project; node-pty main-process isolation is the universally recommended pattern; react-mosaic controlled-component shape is stable.

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  RENDERER PROCESS  (Chromium — contextIsolation: true)              │
│                                                                     │
│  ┌───────────────┐  ┌───────────────────────────────────────────┐  │
│  │  FileTree     │  │  Mosaic Canvas (react-mosaic)             │  │
│  │  Sidebar      │  │  ┌──────────────┐  ┌──────────────┐      │  │
│  │  (read-only)  │  │  │ TermPanel A  │  │ TermPanel B  │ ...  │  │
│  └───────┬───────┘  │  │  PanelHeader │  │  PanelHeader │      │  │
│          │          │  │  xterm.js    │  │  xterm.js    │      │  │
│          │          │  └──────┬───────┘  └──────┬───────┘      │  │
│          │          └─────────┼─────────────────┼──────────────┘  │
│          │                    │                 │                  │
│  ┌───────┴────────────────────┴─────────────────┴──────────────┐  │
│  │                  Zustand Panel Store                         │  │
│  │  { mosaicTree, panels: Map<id, PanelMeta>, projectRoot }    │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
│                               │                                    │
│  ┌────────────────────────────┴─────────────────────────────────┐  │
│  │               window.electronAPI  (contextBridge)            │  │
│  │  pty.create / pty.write / pty.resize / pty.kill              │  │
│  │  pty.onData / pty.onAttention                                │  │
│  │  folder.open / folder.readdir                                │  │
│  └────────────────────────────┬─────────────────────────────────┘  │
└───────────────────────────────┼────────────────────────────────────┘
                                │  IPC (ipcRenderer.invoke / .on)
┌───────────────────────────────┼────────────────────────────────────┐
│  PRELOAD SCRIPT               │                                    │
│  contextBridge.exposeInMainWorld('electronAPI', { ... })           │
│  Wraps each IPC channel as a typed function — no raw ipcRenderer   │
└───────────────────────────────┼────────────────────────────────────┘
                                │  ipcMain.handle / webContents.send
┌───────────────────────────────┼────────────────────────────────────┐
│  MAIN PROCESS  (Node.js)      │                                    │
│                               │                                    │
│  ┌──────────────────────────┐ │  ┌──────────────────────────────┐ │
│  │  PtyManager              │ │  │  FolderService               │ │
│  │  Map<id, IPty>           │ │  │  dialog.showOpenDialog()     │ │
│  │  pty:create / kill       │ │  │  fs.readdir (recursive)      │ │
│  │  pty:write / resize      │ │  │  folder:open / folder:readdir│ │
│  │  pty:data → webContents  │ │  └──────────────────────────────┘ │
│  │  attention watcher       │ │                                    │
│  └──────────────────────────┘ │  ┌──────────────────────────────┐ │
│                               │  │  LayoutPersistence           │ │
│                               │  │  JSON read/write to          │ │
│                               │  │  <projectRoot>/.multiterm    │ │
│                               │  └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `PtyManager` (main) | Owns Map of all live IPty instances keyed by panel ID; spawns, resizes, kills PTYs; pipes pty.onData to renderer; runs attention watcher on raw output | Renderer via `webContents.send('pty:data', id, chunk)` and `'pty:attention', id`; receives `pty:write`, `pty:resize`, `pty:kill`, `pty:create` from ipcMain.handle |
| `FolderService` (main) | Shows native open-directory dialog; performs `fs.readdir` (shallow + lazy-load on expand) | Renderer via `folder:open` (invoke/handle), `folder:readdir` (invoke/handle) |
| `LayoutPersistence` (main) | Reads and writes `<projectRoot>/.multiterm/layout.json`; serializes mosaic tree + panel metadata | Called by ipcMain handlers `layout:load` and `layout:save`; also writes on any panel state change event forwarded by renderer |
| `Preload script` | Translates every IPC channel into a typed function on `window.electronAPI`; never exposes raw ipcRenderer | Main process IPC ↔ Renderer window.electronAPI |
| `Zustand Panel Store` (renderer) | Single source of truth for: mosaic layout tree, per-panel metadata (title, color, attention state), and project root path | All renderer components read/write here; store actions trigger IPC calls for PTY operations |
| `MosaicCanvas` (renderer) | Renders react-mosaic controlled component; drives split/resize/close; delegates tile content to `TermPanel` | Zustand store for `mosaicTree` shape |
| `TermPanel` (renderer) | Renders one xterm.js terminal; mounts FitAddon + WebLinksAddon; manages xterm Terminal instance lifecycle tied to panel ID | Zustand store for panel metadata; `window.electronAPI` for pty:write, pty:resize; listens to pty:data and pty:attention events |
| `PanelHeader` (renderer) | Editable title (double-click), color dot picker, attention badge, close button | Zustand store to update panel metadata |
| `FileTree` (renderer) | Displays project directory recursively; lazy-loads subdirectories on expand | `window.electronAPI.folder.readdir` |
| `AttentionWatcher` (main) | Regex scan on raw pty output per panel ID; emits `pty:attention` event + triggers `Notification` API | Part of PtyManager's `onData` pipeline |

---

## Recommended Project Structure

```
src/
├── main/
│   ├── index.ts              # BrowserWindow creation, app lifecycle
│   ├── pty-manager.ts        # PtyManager class — all node-pty logic
│   ├── folder-service.ts     # dialog + fs.readdir handlers
│   ├── layout-persistence.ts # JSON layout read/write
│   ├── attention-watcher.ts  # Output pattern detection
│   └── ipc-handlers.ts       # Registers all ipcMain.handle() calls
├── preload/
│   └── index.ts              # contextBridge.exposeInMainWorld
├── renderer/
│   ├── index.html
│   └── src/
│       ├── main.tsx           # React root
│       ├── App.tsx            # Top-level layout (sidebar + canvas)
│       ├── store/
│       │   └── panels.ts      # Zustand store
│       ├── components/
│       │   ├── MosaicCanvas/
│       │   ├── TermPanel/
│       │   ├── PanelHeader/
│       │   └── FileTree/
│       ├── hooks/
│       │   ├── usePtyEvents.ts   # subscribes to pty:data / pty:attention
│       │   └── useFileTree.ts    # wraps folder.readdir calls
│       └── types/
│           └── electron-api.d.ts # TypeScript types for window.electronAPI
├── shared/
│   └── types.ts              # PanelMeta, IpcChannels, etc. shared across processes
└── electron.vite.config.ts
```

### Structure Rationale

- **`main/`**: All Node.js-privileged code in one place. Never imported by renderer. PtyManager is a class (not a module-level singleton) so it can be easily tested and reset between tests.
- **`preload/`**: Single file; its sole job is translating IPC channels to typed functions. Keeping it minimal reduces security surface area.
- **`shared/`**: Types that main and renderer both need (e.g. `PanelMeta`, IPC channel string constants). electron-vite supports a shared entry; avoids duplicating type definitions.
- **`renderer/src/store/`**: Zustand store isolated to its own folder; components never import IPC helpers directly — they call store actions, which internally call `window.electronAPI`.

---

## Architectural Patterns

### Pattern 1: PtyManager with ID-keyed Map

**What:** Main process keeps a `Map<string, IPty>` where keys are panel UUIDs. Every IPC call from the renderer includes the panel ID, making operations stateless from the renderer's perspective.

**When to use:** Any time you have N resource instances (PTYs, file watchers) that must outlive individual React component mounts/unmounts.

**Trade-offs:** Simple and explicit. The renderer drives lifecycle (create on panel add, kill on panel close). The map never grows unbounded because kills clean it up.

**Example:**
```typescript
// src/main/pty-manager.ts
class PtyManager {
  private ptys = new Map<string, IPty>();

  create(id: string, cwd: string, shell: string) {
    const pty = spawn(shell, [], { cwd, cols: 80, rows: 24 });
    pty.onData(data => {
      this.emit('data', id, data);          // → webContents.send('pty:data', id, data)
      this.attentionWatcher.check(id, data); // → maybe webContents.send('pty:attention', id)
    });
    this.ptys.set(id, pty);
  }

  write(id: string, data: string) { this.ptys.get(id)?.write(data); }
  resize(id: string, cols: number, rows: number) { this.ptys.get(id)?.resize(cols, rows); }
  kill(id: string) { this.ptys.get(id)?.kill(); this.ptys.delete(id); }
}
```

### Pattern 2: contextBridge Typed API Contract

**What:** The preload script exposes a single `window.electronAPI` object. Every channel is a named async function or event-listener registration. The `renderer/types/electron-api.d.ts` file mirrors the shape with TypeScript types.

**When to use:** Mandatory in any Electron app with `contextIsolation: true`. Never expose raw `ipcRenderer`.

**Trade-offs:** Small boilerplate cost, but eliminates a class of XSS-to-RCE security bugs. Also makes the API surface inspectable and testable.

**Example:**
```typescript
// src/preload/index.ts
contextBridge.exposeInMainWorld('electronAPI', {
  pty: {
    create:  (id, cwd, shell) => ipcRenderer.invoke('pty:create', id, cwd, shell),
    write:   (id, data)       => ipcRenderer.invoke('pty:write', id, data),
    resize:  (id, cols, rows) => ipcRenderer.invoke('pty:resize', id, cols, rows),
    kill:    (id)             => ipcRenderer.invoke('pty:kill', id),
    onData:  (cb) => { ipcRenderer.on('pty:data', (_e, id, data) => cb(id, data)); },
    onAttention: (cb) => { ipcRenderer.on('pty:attention', (_e, id) => cb(id)); },
  },
  folder: {
    open:    ()    => ipcRenderer.invoke('folder:open'),
    readdir: (dir) => ipcRenderer.invoke('folder:readdir', dir),
  },
  layout: {
    load: (root) => ipcRenderer.invoke('layout:load', root),
    save: (root, data) => ipcRenderer.invoke('layout:save', root, data),
  },
});
```

### Pattern 3: Zustand as Single Source of Truth with IPC Side Effects

**What:** Zustand store holds all panel state. Store actions call `window.electronAPI` as a side effect. React components never call IPC directly — they dispatch store actions.

**When to use:** Keeps IPC calls out of component code. Enables easy testing of store actions in isolation and avoids duplicated imperative logic across components.

**Trade-offs:** Slight indirection (component → store action → IPC), but consistent with React unidirectional data flow. State stays in Zustand; native PTY state stays in main process — they shadow each other.

**Example:**
```typescript
// src/renderer/src/store/panels.ts
interface PanelStore {
  mosaicTree: MosaicNode<string> | null;
  panels: Map<string, PanelMeta>;
  addPanel: (cwd: string) => void;
  removePanel: (id: string) => void;
  setAttention: (id: string, val: boolean) => void;
}

const usePanelStore = create<PanelStore>((set, get) => ({
  panels: new Map(),
  addPanel: async (cwd) => {
    const id = crypto.randomUUID();
    await window.electronAPI.pty.create(id, cwd, detectShell());
    set(s => ({
      panels: new Map(s.panels).set(id, { id, title: 'Terminal', color: '#888', attention: false }),
      mosaicTree: addToMosaicTree(s.mosaicTree, id),
    }));
  },
  removePanel: async (id) => {
    await window.electronAPI.pty.kill(id);
    set(s => {
      const panels = new Map(s.panels);
      panels.delete(id);
      return { panels, mosaicTree: removeFromMosaicTree(s.mosaicTree, id) };
    });
  },
  setAttention: (id, val) =>
    set(s => {
      const panels = new Map(s.panels);
      const p = panels.get(id);
      if (p) panels.set(id, { ...p, attention: val });
      return { panels };
    }),
}));
```

### Pattern 4: FitAddon Resize Roundtrip

**What:** When a panel container resizes (via react-mosaic drag or window resize), the xterm FitAddon recalculates cols/rows from the DOM, then the new dimensions must be forwarded to the PTY via `pty:resize`. Both sides must update together to prevent output corruption.

**When to use:** Always. Failing to propagate resize to the PTY causes visible display artifacts (clipped lines, misaligned prompt).

**Trade-offs:** ResizeObserver on the container div is the correct trigger — not `window.resize`, which fires too early relative to mosaic layout changes.

**Example:**
```typescript
// src/renderer/src/components/TermPanel/TermPanel.tsx
useEffect(() => {
  const observer = new ResizeObserver(() => {
    fitAddon.fit();
    const { cols, rows } = terminal;
    window.electronAPI.pty.resize(panelId, cols, rows);
  });
  observer.observe(containerRef.current!);
  return () => observer.disconnect();
}, [panelId]);
```

---

## Data Flow

### PTY Data Flow (output: shell → screen)

```
Shell process (in OS)
    ↓  stdout/stderr bytes
node-pty IPty.onData(chunk)          [main process — PtyManager]
    ↓
AttentionWatcher.check(id, chunk)    [main process — regex match]
    ↓  (if match)
webContents.send('pty:attention', id)
    ↓
window.electronAPI.pty.onAttention   [renderer — preload bridge]
    ↓
usePanelStore.setAttention(id, true) [renderer — Zustand]
    ↓
PanelHeader attention badge + OS Notification.show()

webContents.send('pty:data', id, chunk)
    ↓
window.electronAPI.pty.onData        [renderer — preload bridge]
    ↓
terminal.write(chunk)                [renderer — xterm.js instance in TermPanel]
```

### PTY Write Flow (input: keypress → shell)

```
User keystroke in xterm.js
    ↓
terminal.onData(data)                [renderer — TermPanel]
    ↓
window.electronAPI.pty.write(id, data)
    ↓
ipcRenderer.invoke('pty:write', id, data)
    ↓
ipcMain.handle('pty:write')          [main process — ipc-handlers.ts]
    ↓
PtyManager.write(id, data)
    ↓
IPty.write(data)                     [node-pty → OS PTY device]
```

### Terminal Resize Flow

```
Panel container DOM resize (ResizeObserver)
    ↓
fitAddon.fit()                       [renderer — recalculates cols/rows from DOM]
    ↓
window.electronAPI.pty.resize(id, cols, rows)
    ↓
PtyManager.resize(id, cols, rows)    [main process]
    ↓
IPty.resize(cols, rows)              [node-pty — informs OS PTY device]
```

### Project Open + Layout Restore Flow

```
App startup / "Open folder" click
    ↓
window.electronAPI.folder.open()     [renderer → main: dialog.showOpenDialog]
    ↓
returns { projectRoot }              [main → renderer]
    ↓
usePanelStore.setProjectRoot(path)   [Zustand]
    ↓
window.electronAPI.layout.load(root) [renderer → main: reads JSON file]
    ↓
returns { mosaicTree, panels[] }
    ↓
store hydrates, panels forEach → electronAPI.pty.create(id, root, shell)
    ↓
Mosaic renders restored layout
```

### Layout Save Flow

```
Any panel mutation (add/remove/resize/rename/recolor)
    ↓
Zustand store action updates state
    ↓
store subscriber calls electronAPI.layout.save(root, snapshot) [debounced ~500ms]
    ↓
ipcMain.handle('layout:save') → fs.writeFile(layoutPath, JSON)
```

---

## Build Order Implications (Phase Dependencies)

The component dependency graph dictates a natural build sequence:

1. **Electron scaffold + IPC foundation** — The preload/contextBridge contract must exist before any other layer. Establish the channel names, TypeScript types in `shared/types.ts`, and the `window.electronAPI` stub. Everything else imports from this contract.

2. **PtyManager + single terminal** — node-pty in main process + one xterm.js panel in renderer, wired by IPC. No layout, no persistence. This proves the end-to-end data flow works.

3. **react-mosaic canvas + Zustand store** — Multi-panel tiling on top of the working single-terminal baseline. The store's `mosaicTree` and `panels` map can now be exercised.

4. **PanelHeader + panel metadata** — Title editing, color picker, close button. These are pure UI operating on the Zustand store — no IPC required.

5. **FolderService + FileTree sidebar** — Folder open dialog and readdir tree. Independent of PTY; can be built in parallel with step 4.

6. **Layout persistence** — Serialize/deserialize Zustand state to JSON. Requires panels shape to be stable (steps 2-4 complete).

7. **AttentionWatcher + notifications** — Plugs into PtyManager's `onData` pipeline. The PTY plumbing (step 2) must exist. Native Notification API is straightforward.

---

## Anti-Patterns

### Anti-Pattern 1: node-pty in the Renderer Process

**What people do:** Enable `nodeIntegration: true` to import node-pty directly in the renderer for simpler code.

**Why it's wrong:** Any JavaScript running in the renderer (including from XSS or malicious packages) gets full Node.js access to the filesystem and processes. node-pty is not thread-safe and crashes unpredictably when used outside the main process. Electron itself warns against this pattern.

**Do this instead:** Keep all node-pty calls in the main process behind ipcMain.handle. This is the constraint already codified in the project's `nodeIntegration: false` requirement.

### Anti-Pattern 2: Exposing Raw ipcRenderer via contextBridge

**What people do:** `contextBridge.exposeInMainWorld('ipc', ipcRenderer)` to skip writing individual wrappers.

**Why it's wrong:** This allows renderer code (or injected scripts) to send arbitrary IPC messages to the main process, bypassing all permission checks. The exposed object also comes out empty because ipcRenderer is an EventEmitter, which doesn't serialize cleanly.

**Do this instead:** Expose one named function per IPC channel, as shown in Pattern 2 above.

### Anti-Pattern 3: Calling IPC Directly from React Components

**What people do:** Call `window.electronAPI.pty.create(...)` inside a `useEffect` in a component, scattering IPC call sites across the codebase.

**Why it's wrong:** Hard to track PTY lifecycle, leads to duplicate create calls on re-renders, and makes layout persistence impossible to reason about.

**Do this instead:** All IPC calls live inside Zustand store actions. Components dispatch actions; they never know about IPC.

### Anti-Pattern 4: Skipping the Resize Roundtrip

**What people do:** Call `fitAddon.fit()` without forwarding the new dimensions to node-pty.

**Why it's wrong:** The PTY kernel device still thinks the terminal is the old size. Long output lines wrap incorrectly, readline apps (vim, less) render broken, and the prompt may be misaligned. This is one of the most common reported xterm.js bugs and almost always has this root cause.

**Do this instead:** Always pair `fitAddon.fit()` with `IPty.resize(cols, rows)` — see Pattern 4.

### Anti-Pattern 5: Using `window.resize` to Trigger FitAddon

**What people do:** Listen on `window.addEventListener('resize', ...)` to call `fitAddon.fit()`.

**Why it's wrong:** The window resize event fires before react-mosaic has finished recalculating tile dimensions via CSS. The fit reads the old container size.

**Do this instead:** Attach a `ResizeObserver` to the individual panel's container `<div>`. This fires after layout is painted with the correct new dimensions.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Direction | Notes |
|----------|---------------|-----------|-------|
| Renderer ↔ Preload | `window.electronAPI` object | Bidirectional (invoke returns Promise; onData registers listener) | Typed in `electron-api.d.ts` |
| Preload ↔ Main | `ipcRenderer.invoke` / `ipcMain.handle` (request-response); `webContents.send` / `ipcRenderer.on` (push events) | Invoke: renderer → main; Push: main → renderer | Two-way channels: `pty:data`, `pty:attention` are push; all others are invoke |
| TermPanel ↔ xterm.js | Direct method calls on `Terminal` instance held in a React ref | Component owns instance | Terminal instance must be created in `useEffect`, not during render |
| TermPanel ↔ PtyManager | Via `window.electronAPI.pty.*` calls and event listeners | Both directions | Panel ID is the routing key on both sides |
| MosaicCanvas ↔ Zustand | react-mosaic `onChange` callback → `store.setMosaicTree()` | Mosaic → Zustand (user drag/resize); Zustand → Mosaic prop (programmatic) | Controlled component pattern |
| LayoutPersistence ↔ Zustand | Zustand store subscriber triggers save; load result hydrates store on startup | Both directions | Save is debounced; load is one-time at project open |

### External Dependencies (no network — local OS only)

| Dependency | Integration | Notes |
|------------|-------------|-------|
| OS shell (bash/zsh/cmd) | `node-pty.spawn(shell, [], { cwd })` | Shell auto-detected from `process.env.SHELL` on macOS/Linux; `cmd.exe` or `powershell.exe` on Windows |
| OS filesystem | `fs.readdir`, `fs.readFile`, `fs.writeFile` in main process only | All paths validated to be under project root before use |
| OS notification daemon | `new Notification({ title, body }).show()` from main process | Cross-platform; requires Electron's Notification API in main process (not Web Notifications API) |

---

## Scaling Considerations

This is a local desktop app — the "users" axis is irrelevant. The meaningful scale dimension is **number of concurrent PTY panels**.

| Panel Count | Architecture Concern | Mitigation |
|-------------|----------------------|------------|
| 1–4 panels (typical) | No issues | Default xterm.js scrollback (1000 lines); no change needed |
| 5–12 panels | Memory from xterm.js scrollback buffers; CPU from multiple onData handlers | Reduce scrollback to 500 lines per panel; consider virtualizing panels not in view |
| 12+ panels | Each panel's xterm.js DOM is live and consuming GPU compositing resources | Lazy-render panels: only mount xterm.js for tiles currently visible; unmount hidden tiles (keep PTY alive, buffer output) |

The AttentionWatcher runs synchronously in the PtyManager `onData` handler — keep regex patterns simple to avoid blocking the main process event loop when output is high-throughput.

---

## Sources

- [Electron IPC Tutorial — official docs](https://www.electronjs.org/docs/latest/tutorial/ipc) — HIGH confidence
- [Electron Context Isolation — official docs](https://www.electronjs.org/docs/latest/tutorial/context-isolation) — HIGH confidence
- [Electron contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge) — HIGH confidence
- [electron-vite project structure guide](https://electron-vite.org/guide/dev) — HIGH confidence
- [node-pty README / Electron example](https://github.com/microsoft/node-pty/blob/main/examples/electron/README.md) — HIGH confidence
- [xterm.js + node-pty integration pattern](https://xtermjs.org/) — HIGH confidence
- [react-mosaic controlled component README](https://github.com/nomcopter/react-mosaic/blob/master/README.md) — HIGH confidence
- [VS Code PtyService Map<id, PersistentTerminalProcess> pattern](https://deepwiki.com/microsoft/vscode/6.2-ai-agents-and-tool-integration) — MEDIUM confidence (implementation pattern derived from VS Code internal architecture)
- [FitAddon + PTY resize roundtrip issue discussion](https://github.com/xtermjs/xterm.js/issues/1914) — HIGH confidence

---

*Architecture research for: Electron multi-panel terminal app (multiterm-studio)*
*Researched: 2026-03-14*
