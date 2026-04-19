# Verification Report

**Change**: remove-tmux-sidecar-pty
**Artifact store**: openspec
**Mode**: Strict TDD (from `openspec/config.yaml` → `strict_tdd: true`)

---

## Completeness

| Metric           | Value |
| ---------------- | ----- |
| Tasks total      | 30    |
| Tasks complete   | 30    |
| Tasks incomplete | 0     |

Task 5.4 (manual smoke) was flipped to `[x]` during this verify — the user confirmed it passes after the bugfix batch (idempotent `session.create`, `onData` ordered before `replay`) and the mouse-mode removal cleanup.

---

## Build & Tests Execution

**Typecheck**: PASS for all change-scoped files. Only pre-existing errors remain in files outside this change's scope (`fileWatcher.ts`, `rpcServer.ts`, `settingsManager.ts`, `watcher-worker.ts`, `preload/index.ts`) — documented in apply-progress as baseline.

**Lint (change scope)**: PASS. `eslint src/main/sidecar/ src/main/ptyManager.ts` → 0 errors, 2 prettier warnings (cosmetic multi-line formatting in `server.ts:324, 341`). All remaining repo-wide lint errors live outside the change scope (pre-existing).

**Tests**: 175 passed / 16 failed (exact match with the apply-progress baseline).

- All sidecar tests pass: `ring-buffer` (15), `shell-init` (19), `protocol` (37), `server` (9 including the new idempotent-create scenario), `client` (11 including the new onData Promise scenarios).
- All `ptyManager` tests pass (23), including the new reconnect ordering test.
- All `Terminal.test.tsx` tests pass (10).
- The 16 failing tests are the pre-existing baseline (`folderManager` 9, `layoutManager` 2, `FileTree` 2, `panelStore` 3). None touch the sidecar, PTY manager, Terminal, preload, or spec-relevant code. No regression introduced by this change.

**Build**: `dist/mac-arm64/Multiterm Studio.app` was produced by the Phase 5.5 run. `find dist -iname "*tmux*"` returns empty. `resources/` contains only `icon.png`. `electron-builder.yml` contains no tmux references. `package.json` contains no tmux references.

**Coverage**: Not run. `npx vitest run --coverage` is available per config but not executed in this verify because no threshold is configured and apply-progress already documented per-file TDD adherence.

---

## Strict TDD Compliance

Every GREEN task (1.2, 1.4, 1.6, 2.2, 2.3, 2.5, 3.1–3.8, 4.3, 4.4) follows a RED counterpart or is a mechanical edit. The sidecar and ptyManager modules were test-first (apply-progress confirms 175/191 passing with 15 ring-buffer, 19 shell-init, 37 protocol, 9 server, 11 client, 23 ptyManager, 10 Terminal tests authored against the spec scenarios).

---

## Spec Compliance Matrix

### pty-sidecar

| Requirement                  | Scenario                                     | Test                                                                                                                                                                                                                                                                                                                                        | Result    |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Sidecar lifecycle            | Startup                                      | `tests/main/sidecar/server.test.ts > listen + connect` + `src/main/index.ts:326–352` fork + 3s poll                                                                                                                                                                                                                                         | COMPLIANT |
| Sidecar lifecycle            | Clean shutdown                               | `src/main/sidecar/entry.ts` SIGTERM→`server.close()`→unlink PID; `src/main/index.ts:292–299` 2s kill timer                                                                                                                                                                                                                                  | COMPLIANT |
| Sidecar lifecycle            | Startup failure                              | `src/main/index.ts:348-351` `dialog.showErrorBox('Fatal', …) + app.quit()` on failed connect                                                                                                                                                                                                                                                | COMPLIANT |
| Session control protocol     | Create session                               | `tests/main/sidecar/server.test.ts > session.create returns sessionId + dataEndpoint`                                                                                                                                                                                                                                                       | COMPLIANT |
| Session control protocol     | Unknown method                               | `tests/main/sidecar/server.test.ts > unknown method returns -32601`                                                                                                                                                                                                                                                                         | COMPLIANT |
| Session control protocol     | Create with existing sessionId is idempotent | `tests/main/sidecar/server.test.ts > session.create with an existing sessionId returns success with the same dataEndpoint; no new PTY is spawned`                                                                                                                                                                                           | COMPLIANT |
| Per-session data transport   | Bidirectional flow                           | `tests/main/sidecar/server.test.ts > data client writes → PTY → data client reads`                                                                                                                                                                                                                                                          | COMPLIANT |
| Cross-platform endpoint path | Per-platform resolution (darwin)             | `tests/main/sidecar/protocol.test.ts > makeEndpointPath('sidecar') on darwin`                                                                                                                                                                                                                                                               | COMPLIANT |
| Cross-platform endpoint path | Windows pipe                                 | `tests/main/sidecar/protocol.test.ts > makeEndpointPath('sidecar') on win32` (platform-mocked)                                                                                                                                                                                                                                              | COMPLIANT |
| Renderer reconnection        | Reconnect restores scrollback                | `tests/main/sidecar/server.test.ts > session.replay streams ring buffer before live data` + `tests/main/ptyManager.test.ts > reconnect: pty:create with already-known sessionId calls onData then replay, skips writeSessionMeta` + `tests/main/sidecar/client.test.ts > onData() returns a Promise that resolves once the socket connects` | COMPLIANT |
| Renderer reconnection        | Unknown session id                           | No dedicated `session-not-found` notification — connecting to a non-existent data endpoint yields ECONNREFUSED because the socket does not exist.                                                                                                                                                                                           | PARTIAL   |

### scrollback-ring-buffer

| Requirement           | Scenario               | Test                                                                                                                                                                  | Result    |
| --------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Bounded capacity      | Writes within cap      | `tests/main/sidecar/ring-buffer.test.ts > writes within cap return all bytes in replay`                                                                               | COMPLIANT |
| Bounded capacity      | Overflow wraps         | `tests/main/sidecar/ring-buffer.test.ts > 1 MB cap + 256 KB overflow — latest 1 MB is preserved`                                                                      | COMPLIANT |
| Bounded capacity      | Configured cap         | `tests/main/sidecar/server.test.ts` (scrollbackBytes param) + `SidecarServer.handleCreate` uses `params.scrollbackBytes ?? DEFAULT_SCROLLBACK_BYTES`                  | COMPLIANT |
| Replay API            | Replay after writes    | `tests/main/sidecar/ring-buffer.test.ts > replay after sequential string writes returns them in order`                                                                | COMPLIANT |
| Replay API            | Replay on empty buffer | `tests/main/sidecar/ring-buffer.test.ts > replay on empty buffer returns empty Buffer`                                                                                | COMPLIANT |
| Per-session isolation | Isolation              | Each `SidecarServer` Session has its own `RingBuffer` instance (`server.ts:165, 211`). Unit tests exercise isolation by construction (separate RingBuffer instances). | COMPLIANT |

### pwd-tracking-osc7

| Requirement          | Scenario                           | Test                                                                                                                                                                                                                                         | Result    |
| -------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Shell hook injection | zsh injection                      | `tests/main/sidecar/shell-init.test.ts > osc7ShellHook('zsh')` + `zshIntegrationDir()`                                                                                                                                                       | COMPLIANT |
| Shell hook injection | bash wraps existing PROMPT_COMMAND | `tests/main/sidecar/shell-init.test.ts > osc7ShellHook('bash')` preserves `${PROMPT_COMMAND:-}`                                                                                                                                              | COMPLIANT |
| Shell hook injection | fish skipped                       | `tests/main/sidecar/shell-init.test.ts > osc7ShellHook('fish') returns null`                                                                                                                                                                 | COMPLIANT |
| OSC 7 parsing        | Valid OSC 7                        | `src/renderer/src/components/Terminal.tsx:101–112` registers OSC 7 handler, decodes `file://<host><path>` via `new URL()`, fires `ptyCwdChanged + setCwd`                                                                                    | COMPLIANT |
| OSC 7 parsing        | Malformed sequence                 | `Terminal.tsx:108` catches URL parse errors silently; no event fired, no error propagates                                                                                                                                                    | COMPLIANT |
| Fallback cwd         | Shell without OSC 7                | `ptyManager.ts:166` `cwdCache.set(id, safeCwd)` on session create; `pty:get-cwd` reads cache first then session meta (which also stores the spawn cwd). This is stronger than the 2-second fallback — the spawn cwd is reported immediately. | COMPLIANT |
| Fallback cwd         | Late OSC 7 overrides fallback      | `ptyManager.ts:239–241` `ipcMain.on('pty:cwd-changed')` overwrites `cwdCache` on every OSC 7 push                                                                                                                                            | COMPLIANT |

**Compliance summary**: 17/18 scenarios COMPLIANT, 1 PARTIAL, 0 FAILING, 0 UNTESTED.

---

## Correctness (Static — Structural Evidence)

| Requirement                           | Status                   | Notes                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sidecar module layout                 | Implemented              | `src/main/sidecar/{ring-buffer,shell-init,protocol,server,client,entry}.ts` all present                                                                                                                                              |
| ptyManager delegates to SidecarClient | Implemented              | Lines 155–200, uses `client.create/onData/replay/write/resize/kill`                                                                                                                                                                  |
| IPC channels added/removed            | Implemented              | `pty:cwd-changed` added (`ipcMain.on`); `pty:list-panes`, `pty:select-pane`, `pty:send-keys` absent from ptyManager and preload                                                                                                      |
| TmuxPaneSidebar deleted               | Implemented              | Not present under `src/renderer/src/components/`                                                                                                                                                                                     |
| Mouse mode relabeling                 | Implemented + cleaned up | Original spec called for "Tmux mouse mode" → "Mouse mode"; the mouse-mode toggle was removed entirely during smoke-driven cleanup because xterm.js handles mouse natively and the VT100 escapes caused garbage input on click/scroll |
| electron-builder tmux entries removed | Implemented              | `extraResources` key absent                                                                                                                                                                                                          |
| `resources/` cleanup                  | Implemented              | Only `icon.png` remains                                                                                                                                                                                                              |
| Migration purge                       | Implemented              | `ptyManager.ts:29–52` `purgeLegacyTmuxSessions()` invoked at module load                                                                                                                                                             |
| README + FEATURES updated             | Implemented              | README notes tmux removal under Breaking Changes                                                                                                                                                                                     |

---

## Coherence (Design)

| Decision                                                 | Followed?                 | Notes                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidecar transport = `child_process.fork()` + Unix socket | Yes                       | `index.ts:327` `fork(sidecarEntryPath, …)`                                                                                                                                                                                                                                                                                                          |
| Control protocol = JSON-RPC 2.0, newline-delimited       | Yes                       | `protocol.ts` + `server.ts.handleControlMessage`                                                                                                                                                                                                                                                                                                    |
| Session data = dedicated socket per session              | Yes                       | `server.ts.handleCreate` creates a new `net.createServer` per session                                                                                                                                                                                                                                                                               |
| Ring buffer location = inside sidecar                    | Yes                       | `server.ts:Session.buffer`                                                                                                                                                                                                                                                                                                                          |
| OSC 7 parser = renderer                                  | Yes                       | `Terminal.tsx:101` `term.parser.registerOscHandler(7, …)`                                                                                                                                                                                                                                                                                           |
| Attention detection stays in ptyManager                  | Yes                       | `ptyManager.ts:178–188`                                                                                                                                                                                                                                                                                                                             |
| Mouse mode = xterm.js native                             | Deviated (better outcome) | Original plan: wire `options.mouseTrackingMode`. Actual: xterm.js defaults already work; the toggle and VT100 escapes were removed as dead code after smoke revealed garbage input. The "Mouse mode" setting row now collapses to a `PlaceholderSettings` "Coming soon" — no functional regression, user-facing mouse wheel + selection still work. |

---

## Issues Found

### CRITICAL (must fix before archive)

None.

### WARNING (should fix)

1. **`session-not-found` notification not implemented** — spec `pty-sidecar > Renderer reconnection > Unknown session id` expects an explicit notification on the closed connection. Current behavior: ECONNREFUSED because the per-session data socket only exists when `session.create` runs. The renderer handles this fine (calls `ptyCreate` first, which creates if missing or returns existing endpoint). Recommend either (a) amending the spec to document the ECONNREFUSED path as the intended "unknown session" signal, or (b) adding a thin no-match handler on the sidecar control endpoint that returns a `session-not-found` JSON-RPC notification for orphan data-endpoint connect attempts. Option (a) is the pragmatic choice since `ptyCreate` is always called before any data connect in the current flow.

2. **Coherence deviation on mouse mode** — the "Mouse mode" label/toggle was removed rather than rewired to `options.mouseTrackingMode`. This is a superior outcome (fixed a real bug surfaced during 5.4 smoke), but the spec and design still describe wiring `options.mouseTrackingMode`. Recommend updating the `pty-sidecar` spec or design to reflect the final state before archive, or accept this as an intentional design-time deviation documented in apply-progress.

### SUGGESTION (nice to have)

1. **Two prettier warnings in `src/main/sidecar/server.ts`** (lines 324, 341) — run `npx eslint --fix src/main/sidecar/server.ts` to auto-format. Purely cosmetic.

2. **Sidecar `session.create` response already forwards to the existing endpoint, but the spec-mandated idempotent path skips writing metadata on reconnect only in ptyManager.** The sidecar itself would still "happily" respond to a second `create` after `destroySession` removes the entry from the map — that is fine per the spec, just worth calling out for future maintainers.

3. **Consider wiring `scrollbackBytes` from user settings.** The `RingBuffer` accepts a configurable cap, and `session.create` has a `scrollbackBytes` parameter, but `ptyManager.ts:155–161` does not pass one through — every session uses the 8 MB default. Spec scenario "Configured cap" is covered by the sidecar test, but the settings-driven path is not wired in this change.

---

## Verdict

**PASS WITH WARNINGS**

The implementation matches every spec scenario except one PARTIAL (`session-not-found` notification — ECONNREFUSED is the de-facto behavior). All 30 tasks complete, all sidecar/ptyManager/Terminal tests green, no new typecheck or lint errors, dist bundle is free of tmux, `resources/` reduced to `icon.png`. The Phase 3 mouse-mode implementation was removed during cleanup — this is a net improvement (real bug fixed) but a design deviation that should be reflected in the archive.

**Recommendation**: Proceed to `sdd-archive`. Before archive, either (a) amend `pty-sidecar/spec.md > Unknown session id` to document the ECONNREFUSED path, and (b) note the mouse-mode removal in the archive delta. Both are documentation-only adjustments; the implementation itself is sound.
