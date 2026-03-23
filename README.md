# Multiterm Studio

A project-scoped multi-terminal workspace with an infinite canvas, floating tiles, and deep AI agent integration.

Built with Electron, React, TypeScript, xterm.js, and tmux.

## Features

### Infinite Canvas
- Drag, resize, and arrange terminal/editor/note/image tiles freely on an infinite canvas
- Pan with scroll wheel or Space+drag, zoom with pinch or Ctrl+scroll
- Grid snap (24px) for precise alignment
- Minimap for canvas navigation
- Edge indicators for off-screen tiles

### Terminal
- Tmux-backed terminals with session persistence and scrollback recovery
- Quick Start presets: Claude Code, Codex, OpenCode, Shell (custom commands supported)
- Running process indicator with close confirmation
- PWD tracking via tmux (status bar updates on directory change)
- Tmux pane sidebar for switching between team agent panes
- Mouse mode toggle in Settings

### Canvas Interaction
- Content overlay: click to drag unfocused tiles, click again to enter
- Maximize/restore tiles to fullscreen (respects sidebar width)
- Spatial navigation between tiles (Cmd+Opt+Arrows)
- Tidy/auto-arrange selected tiles in a grid (Cmd+Opt+T)
- Zoom to fit all tiles (Cmd+Opt+0) or focused tile (Cmd+Opt+F)
- Duplicate any tile (Cmd+Shift+D)
- Opacity feedback: 85% unfocused, 92% selected, 100% focused
- Cell size indicator (cols x rows) during resize
- Multi-select with Shift+click or marquee selection

### Code Editor
- Monaco Editor with 40+ language support
- Markdown preview with Mermaid diagram rendering
- Dirty state tracking with save indicator (Cmd+S)

### Notes
- TipTap rich text editor with task lists, formatting, and headings
- Draggable on canvas

### Images
- Image tiles for PNG, JPG, GIF, SVG, WebP
- SVG toggle between image preview and code editor

### File Management
- File tree sidebar with search, sort (4 modes), and filter
- Context menu: New File, New Folder, Rename (F2), Delete, Copy Path
- Drag files from sidebar to canvas to create tiles
- Drag-drop between folders
- Inline rename with F2

### Project Management
- Recent projects with search on welcome screen
- Git branch display and switching
- Workspace config persistence (expanded dirs per project)
- File watcher via @parcel/watcher in utility process

### AI Agent Integration
- Claude Code hooks for session tracking and agent spawning
- Tmux pane sidebar shows team agent panes with names
- Agent activity indicator in card header
- JSON-RPC server for external tool communication

### Appearance
- Dark / Light / System theme modes (Shift+Cmd+T to cycle)
- Lucide React icons throughout
- Settings panel with tmux mouse mode toggle
- Native macOS titlebar with traffic lights

### Menu Bar & Shortcuts

| Action | Shortcut |
|--------|----------|
| New Terminal | Cmd+T |
| New Note | Cmd+Shift+N |
| Duplicate Tile | Cmd+Shift+D |
| Close Tile | Cmd+W |
| Toggle Sidebar | Cmd+B |
| Zoom to Fit All | Cmd+Opt+0 |
| Zoom to Fit Focused | Cmd+Opt+F |
| Tidy Selection | Cmd+Opt+T |
| Navigate Left/Right/Up/Down | Cmd+Opt+Arrows |
| Maximize/Restore | Header button |
| Cycle Theme | Shift+Cmd+T |
| Fullscreen | Shift+Cmd+F |
| Settings | Cmd+, |

## Setup

### Install

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Build

```bash
# macOS
pnpm build:mac

# Windows
pnpm build:win

# Linux
pnpm build:linux
```

### CLI

After first launch, a `multiterm` command is installed at `~/.local/bin/`:

```bash
multiterm /path/to/project
```

## Tech Stack

- **Electron** — desktop shell
- **React 19** + **TypeScript** — UI
- **xterm.js** — terminal emulation
- **tmux** — session multiplexing and persistence
- **Monaco Editor** — code editing
- **TipTap** — rich text notes
- **Zustand** — state management
- **@parcel/watcher** — native file watching
- **Lucide React** — icons
- **electron-vite** — build tooling
