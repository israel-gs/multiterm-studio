# Proposal: Remove tmux, replace with sidecar PTY backend

## Intent

tmux is a bundled native dependency (~947 KB of binary + dylibs + terminfo) that currently provides session multiplexing, scrollback recovery, PWD tracking, and pane navigation. Its pane-navigation role disappears once the app drops Claude Code Team Agents in favor of a per-pane-per-agent model. The remaining roles are better served by direct node-pty plus a small out-of-process sidecar, eliminating an unnecessary architectural layer and shrinking the shipped binary.

## Scope

### In Scope

- Replace tmux with a sidecar process (node-pty host) talking to Electron main via JSON-RPC 2.0 over Unix socket.
- Add in-memory ring buffer per session for scrollback, replayed on reconnect.
- Replace tmux PWD tracking with OSC 7 emitted by shell init injected at spawn.
- Replace tmux mouse mode toggle with xterm.js native mouse config.
- Remove bundled tmux binary, `tmux.conf`, terminfo, and dylibs from `electron-builder.yml`.
- Delete `TmuxPaneSidebar`, related IPC (`pty:list-panes`, `pty:select-pane`, `pty:send-keys`), and tmux-specific settings copy.
- Update README and `.planning/research/FEATURES.md`.

### Out of Scope

- CLI bridge for multi-agent orchestration (separate future change).
- Full-process survival if the sidecar itself dies (only renderer-restart survival is delivered).
- Sidecar survival across Electron quit — quit shuts the sidecar down cleanly; restart spawns a fresh one.
- Windows/Linux parity tuning beyond what node-pty natively supports; macOS is the primary target for this change.

## Capabilities

### New Capabilities

- `pty-sidecar`: out-of-process node-pty host, JSON-RPC 2.0 control plane, Unix socket transport, session lifecycle (create, write, resize, kill).
- `scrollback-ring-buffer`: bounded in-memory scrollback per session with configurable byte cap and replay API.
- `pwd-tracking-osc7`: working-directory reporting via OSC 7 escape sequence parsed from the PTY output stream.

### Modified Capabilities

None. No prior specs existed before this change.

## Approach

The sidecar is a Node process spawned by Electron main on startup. It owns all `pty.spawn` calls and exposes JSON-RPC 2.0 methods (`session.create`, `session.write`, `session.resize`, `session.kill`, `session.replay`). Each session gets its own data socket plus an in-memory ring buffer (default 8 MB, configurable between 16 KB and 64 MB from Settings). `ptyManager.ts` becomes a thin client of this sidecar.

Transport per platform via `makeEndpointPath()`:

- macOS / Linux — Unix sockets under `~/.multiterm-studio/` (`sidecar.sock` for control, `pty-sessions/{id}.sock` for data).
- Windows — Named Pipes (`\\.\pipe\multiterm-sidecar`, `\\.\pipe\multiterm-session-{id}`).

OSC 7 uses a dual-layer strategy:

- Layer 1 (all shells): after spawn, inject a runtime hook into the PTY — `precmd_functions+=(...)` for zsh, wrapped `PROMPT_COMMAND` for bash/sh, no-op for fish (native).
- Layer 2 (zsh only): build a `ZSH_INTEGRATION_DIR` with a custom `.zshrc` that sources the user's real config and appends the hook; spawn zsh with `ZDOTDIR` pointing there for robustness across sub-shells.

Mouse control moves to xterm.js native handlers. The sidecar is lifecycle-bound to Electron main: quit main → shut down sidecar cleanly. No survival across quit in this change.

## Affected Areas

| Area                                              | Impact   | Description                                        |
| ------------------------------------------------- | -------- | -------------------------------------------------- |
| `src/main/ptyManager.ts`                          | Modified | ~40% rewrite; delegates to sidecar client.         |
| `src/main/sidecar/`                               | New      | server, client, protocol, ring-buffer, entry.      |
| `src/main/index.ts`                               | Modified | Sidecar bootstrap + shutdown; drop tmux calls.     |
| `src/preload/index.ts` + `.d.ts`                  | Modified | Remove list-panes/select-pane/send-keys.           |
| `src/renderer/src/components/TmuxPaneSidebar.tsx` | Removed  | Delete component.                                  |
| `src/renderer/src/components/SettingsPanel.tsx`   | Modified | Rename "Tmux mouse" → "Mouse"; rewire to xterm.js. |
| `electron-builder.yml`                            | Modified | Drop tmux extraResources.                          |
| `resources/tmux*`, `lib/`, `terminfo/`            | Removed  | Delete bundled assets.                             |
| `README.md`, `.planning/research/FEATURES.md`     | Modified | Update stack description.                          |

## Risks

| Risk                                           | Likelihood | Mitigation                                                        |
| ---------------------------------------------- | ---------- | ----------------------------------------------------------------- |
| Sidecar orphaned or failing to start           | Med        | PID file + health check + graceful shutdown on main quit.         |
| OSC 7 missing in user's custom shell           | Med        | Inject init via env; document override; fallback to cwd-at-spawn. |
| Ring buffer memory pressure with many sessions | Low        | Configurable byte cap; default 8 MB per session.                  |
| Lost running processes if sidecar dies         | Med        | Documented limitation; out-of-scope for this change.              |

## Rollback Plan

Change lives on branch `refactor/remove-tmux-sidecar-pty`. Revert the merge commit to restore tmux atomically — all tmux code and bundled assets are removed in the same change, so revert is clean.

## Dependencies

- `node-pty` (already bundled).
- No new npm packages required.

## Success Criteria

- [ ] Terminals spawn, accept input, render output, resize, and report PWD without tmux on the host.
- [ ] Renderer restart preserves scrollback and cwd via sidecar reconnect.
- [ ] `electron-builder` output no longer contains tmux binary or related resources.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test` all green.
- [ ] All non-tmux features (notes, canvas, agent presets, settings) unchanged.
