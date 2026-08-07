# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Security

- The JSON-RPC control socket now lives in `~/.multiterm-studio/` with owner-only
  permissions instead of world-accessible `/tmp`, and every request must carry the
  token from `~/.multiterm-studio/socket-token`. This socket can run commands in
  your terminals (`pane.runCommand`), so it was previously reachable by any other
  user on the machine.
- The sidecar control and per-session data sockets are owner-only too.
- `local-resource://` now only serves files inside the folders currently open in
  the workspace. Symlinks are resolved before the check, so a link inside a
  project cannot reach out of it.
- Markdown preview sanitizes embedded HTML (`rehype-sanitize`), stripping
  scripts, iframes, inline event handlers and `javascript:` links from documents
  that come from cloned repositories.
- Clipboard writes from terminal programs (OSC 52) can be turned off in
  **Settings → Terminal**. They remain on by default, matching other terminals,
  but the sequence is also honoured for processes on remote machines.
- The agent transcript viewer is launched with arguments instead of an
  interpolated shell string, so values arriving over the RPC socket can no longer
  inject commands.
- Removed the unbounded `~/.multiterm-studio/hook-debug.log`, which recorded every
  hook payload in plain text.

### Fixed

- Terminals no longer leak when switching projects: the outgoing project's PTYs
  are killed and the panel store is reset. **Terminals no longer survive a project
  switch** — reopening a project starts fresh shells.
- A shell that exits (or a sidecar that dies) is now reported in the tile instead
  of leaving a terminal that looks alive forever. The session's socket file is
  cleaned up and the id can be reused.
- Calls to the sidecar time out instead of hanging forever when it goes away.
- `multiterm <dir>` from the CLI now actually opens that folder. Double-clicking a
  `.multiterm-workspace` file works too.
- Only one instance runs at a time; a second `multiterm` invocation focuses the
  existing window instead of racing over the same sidecar socket.
- Workspace folders on unmounted volumes are no longer silently dropped from the
  `.multiterm-workspace` file on the next save.
- Terminals no longer inherit `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`, which
  broke Node-based tooling run from a tile.
- Interactive prompts split across two PTY reads are detected; the same for OSC 52
  sequences, now handled by xterm's parser.
- Branch names are passed to git after `--end-of-options`, so a name that looks
  like a flag cannot be parsed as one.
- The running-process indicator works: it reports the command running in a tile
  instead of always saying "none".
- Removing one folder from a workspace no longer stops the file watcher for the
  remaining folders.
- Layout changes pending in the save debounce are flushed instead of discarded.
- Recent projects are written atomically; paths use a separator-aware basename.
- `postinstall` works on Linux and Windows (it used a macOS-only `sed`).

### Changed

- Claude Code hooks are registered in `.claude/settings.local.json` instead of the
  committed `.claude/settings.json`, and the hook scripts live in
  `~/.multiterm-studio/hooks/` instead of being generated inside your repository.
  Projects set up by an older version are migrated automatically on open.
- The OpenCode plugin still has to live in the project (OpenCode only loads
  plugins from there), but is now added to the project's `.gitignore`.
- Notifications: at most one per session, superseded rather than stacked.

### Performance

- Terminals render through WebGL, falling back to the DOM renderer when no
  context is available.
- Monaco and Mermaid load on demand. The initial renderer bundle went from
  ~10.8 MB to ~1.3 MB.
- Only runtime dependencies are packaged: the app archive went from ~251 MB to
  ~35 MB.
- Terminal resize is coalesced per frame and only notifies the PTY when the cell
  grid actually changes.
- Per-terminal scrollback is bounded at 50,000 lines (was 200,000, which cost
  memory per tile before any output).

### Internal

- CI runs lint, typecheck, tests and a build on Linux and macOS.
- `typecheck` passes: it previously reported 53 errors.
- The renderer's view of the preload bridge is derived from the implementation,
  so the two cannot drift (they already had).

## [1.2.0]

### Removed

- The `pane.sendKeys` JSON-RPC method. It was tmux-only and has no replacement in
  the sidecar PTY architecture.
