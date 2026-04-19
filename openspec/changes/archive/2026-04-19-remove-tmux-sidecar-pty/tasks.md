# Tasks: Remove tmux, replace with sidecar PTY backend

Strict TDD is active: every GREEN task follows a RED (failing-test) task.

## Phase 1: Foundation

- [x] 1.1 RED: `src/main/sidecar/ring-buffer.test.ts` — write, replay, overflow-wraps, resize, per-instance isolation.
- [x] 1.2 GREEN: create `src/main/sidecar/ring-buffer.ts` — `write(bytes)`, `replay()`, `resize(bytes)`.
- [x] 1.3 RED: `src/main/sidecar/shell-init.test.ts` — `osc7ShellHook(shell)` returns correct payload for zsh / bash / sh / fish (null); `zshIntegrationDir()` writes a `.zshrc` that sources `_MTS_ZDOTDIR` then appends the hook.
- [x] 1.4 GREEN: create `src/main/sidecar/shell-init.ts`.
- [x] 1.5 RED: `src/main/sidecar/protocol.test.ts` — `makeEndpointPath("sidecar")` returns `~/.multiterm-studio/sidecar.sock` on darwin/linux; JSON-RPC request/response/error codecs round-trip.
- [x] 1.6 GREEN: create `src/main/sidecar/protocol.ts` — types, `makeEndpointPath`, JSON-RPC codecs, constants.

## Phase 2: Sidecar core

- [x] 2.1 RED: `tests/main/sidecar/server.test.ts` — JSON-RPC over real Unix socket; `session.create` returns `sessionId` + `dataEndpoint`; `write`/`resize`/`kill` round-trip; unknown method → `-32601`; `session.replay` streams ring buffer before live data.
- [x] 2.2 GREEN: create `src/main/sidecar/server.ts` — control socket, per-session data sockets, PTY registry, ring buffer wiring.
- [x] 2.3 GREEN: create `src/main/sidecar/entry.ts` — child-process entry; boots server; writes `sidecar.pid`; handles SIGTERM for clean shutdown.
- [x] 2.4 RED: `tests/main/sidecar/client.test.ts` — `SidecarClient` request/response correlation; replay stream handling; error propagation.
- [x] 2.5 GREEN: create `src/main/sidecar/client.ts`.
- [x] 2.6 Update `electron.vite.config.ts` — add sidecar entry to the main build so `out/main/sidecar-entry.js` exists.

## Phase 3: Integration

- [x] 3.1 Refactor `src/main/ptyManager.ts` — delete tmux helpers; delegate `pty:create/write/resize/kill/has-process` to `SidecarClient`; keep attention detection on the inbound data stream.
- [x] 3.2 Remove IPC handlers `pty:list-panes`, `pty:select-pane`, `pty:send-keys` from `ptyManager.ts`.
- [x] 3.3 Add IPC `pty:cwd-changed` (renderer → main) + in-memory cache; rewire `pty:get-cwd` to read from the cache.
- [x] 3.4 Update `src/preload/index.ts` and `src/preload/index.d.ts` — drop `ptyListPanes`, `ptySelectPane`, `ptySendKeys`; add `ptyCwdChanged`.
- [x] 3.5 Update `src/main/index.ts` — boot sidecar before `createWindow`; graceful shutdown on `before-quit`; drop tmux imports.
- [x] 3.6 Update `src/renderer/src/components/Terminal.tsx` — register `terminal.parser.registerOscHandler(7, …)`; call `ptyCwdChanged(id, cwd)` on each fire.
- [x] 3.7 Delete `src/renderer/src/components/TmuxPaneSidebar.tsx` and all its imports; drop orphaned `agentNames` store slice if unused.
- [x] 3.8 Update `src/renderer/src/components/SettingsPanel.tsx` — relabel "Tmux mouse mode" → "Mouse mode"; wire to xterm `options.mouseTrackingMode` via store.

## Phase 4: Removal and cleanup

- [x] 4.1 Delete `resources/tmux`, `resources/tmux.conf`, `resources/lib/`, `resources/terminfo/`.
- [x] 4.2 Remove tmux entries from `extraResources` in `electron-builder.yml`.
- [x] 4.3 Add one-shot migration in `ptyManager` init — purge stale tmux session JSON under `~/.multiterm-studio/sessions/` older than the upgrade.
- [x] 4.4 Update `README.md` and `.planning/research/FEATURES.md` — drop tmux from stack and features list; describe sidecar + OSC 7.
- [x] 4.5 Drop tmux references from `package.json` `postinstall` and any scripts under `scripts/`.

## Phase 5: Verification

- [x] 5.1 `npm run typecheck` green.
- [x] 5.2 `npm run lint` green.
- [x] 5.3 `npm run test` green (all new unit + integration tests pass).
- [x] 5.4 Manual smoke: `npm run dev`; create pane, resize, scroll; reload renderer → scrollback replays; change directory → cwd reflects in UI.
- [x] 5.5 `npm run build:mac:unsigned` — verify `dist/**` no longer contains any `tmux` binary or `tmux.conf`.
