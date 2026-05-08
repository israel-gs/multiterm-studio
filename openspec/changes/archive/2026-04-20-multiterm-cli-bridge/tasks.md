# Tasks: multiterm CLI bridge

Strict TDD: every GREEN follows a RED.

## Phase 1: Foundation

- [x] 1.1 Add `better-sqlite3` to `package.json` dependencies; confirm `electron-builder install-app-deps` rebuilds it natively.
- [x] 1.2 RED: `tests/main/bridge/protocol.test.ts` — JSON-RPC codec round-trip; error code constants stable.
- [x] 1.3 GREEN: `src/main/bridge/protocol.ts` — types, method-name constants, error codes, codec helpers.
- [x] 1.4 RED: `tests/main/bridge/db.test.ts` — open `:memory:`, run migrations to v1, verify `schema_version` and table presence; idempotent re-run.
- [x] 1.5 GREEN: `src/main/bridge/db.ts` — connection factory, migration runner, v1 schema (agents, messages, tasks, kv).

## Phase 2: Subsystems

- [x] 2.1 RED: `tests/main/bridge/registry.test.ts` — auto-register on touch, alias assign, collision (`-32021`), resolve by id and `@alias`, missing target (`-32020`), deregister releases alias.
- [x] 2.2 GREEN: `src/main/bridge/registry.ts`.
- [x] 2.3 RED: `tests/main/bridge/kv.test.ts` — set/get/del/list, key/value constraints (`-32050`, 64 KiB), prefix filter, persistence across reopen.
- [x] 2.4 GREEN: `src/main/bridge/kv.ts`.
- [x] 2.5 RED: `tests/main/bridge/tasks.test.ts` — create, atomic claim under contention, valid/invalid transitions, ownership (`-32001`/`-32031`), list filters, persistence.
- [x] 2.6 GREEN: `src/main/bridge/tasks.ts`.
- [x] 2.7 RED: `tests/main/bridge/messaging.test.ts` — send-to accept/decline/timeout (60 s default, clamp), notify ack, persistence, orphan-on-restart.
- [x] 2.8 GREEN: `src/main/bridge/messaging.ts` — pending-promise registry plus IPC events `bridge:pending`, `bridge:accept`, `bridge:decline`.

## Phase 3: Daemon

- [x] 3.1 RED: `tests/main/bridge/server.test.ts` — listen on `makeEndpointPath("bridge")`, dispatch each `bridge.*` method, parallel clients, `BridgeDisabled`/`BridgeShutdown` semantics.
- [x] 3.2 GREEN: `src/main/bridge/server.ts` — socket server, dispatcher, lifecycle hooks.

## Phase 4: Sidecar env extension

- [x] 4.1 RED: extend `tests/main/sidecar/server.test.ts` — `env` merges into PTY environment; absent → process.env only; idempotent reconnect does not re-apply.
- [x] 4.2 GREEN: `src/main/sidecar/protocol.ts` (add `env?: Record<string,string>`) + `src/main/sidecar/server.ts` (spread into `pty.spawn` env).
- [x] 4.3 Modify `src/main/ptyManager.ts` — pass `{ MULTITERM_PANE_ID: id }` in `client.create`.

## Phase 5: CLI binary

- [x] 5.1 RED: `tests/main/bridge/cli.test.ts` — argv parsing, exit codes (0/2/3/4/5/6/7), `--json` output, help, missing `MULTITERM_PANE_ID`.
- [x] 5.2 GREEN: `src/main/bridge/cli/index.ts` + `entry.ts` — pure run() module, Unix-socket JSON-RPC client, output formatter.
- [x] 5.3 Update `electron.vite.config.ts` — add `cli-entry` bundle entry producing `out/main/cli-entry.js`.
- [x] 5.4 Modify `src/main/cliInstaller.ts` — bump installer schema to 2; force-overwrite `~/.local/bin/multiterm` with launcher that `exec`s the bundled CJS.

## Phase 6: Renderer

- [x] 6.1 RED: `tests/renderer/bridgeStore.test.ts` — pending count per pane, accept/decline mutations.
- [x] 6.2 GREEN: `src/renderer/src/store/bridgeStore.ts`.
- [x] 6.3 Update `src/preload/index.ts` + `index.d.ts` — `bridgeOnPending`, `bridgeAccept`, `bridgeDecline`.
- [x] 6.4 RED: `tests/renderer/MessageAcceptModal.test.tsx` — render pending list, accept/decline buttons dispatch IPC.
- [x] 6.5 GREEN: `src/renderer/src/components/MessageAcceptModal.tsx`.
- [x] 6.6 Modify `src/renderer/src/components/FloatingCard.tsx` — chip on header when pending > 0; click opens modal.
- [x] 6.7 Modify `src/renderer/src/components/SettingsPanel.tsx` — Bridge on/off toggle wired to `settings.bridge.enabled`.

## Phase 7: Wire-up

- [x] 7.1 Add `getBridgeEnabled()` / `setBridgeEnabled()` in `src/main/settingsManager.ts` (default true).
- [x] 7.2 Modify `src/main/index.ts` — boot bridge after sidecar (gated by setting); on `before-quit` resolve in-flight calls with `BridgeShutdown`.
- [x] 7.3 Update `electron-builder.yml` — `extraResources` ships `out/main/cli-entry.js`; `asarUnpack` extended to include `**/*.node` for better-sqlite3.

## Phase 8: Verification

- [x] 8.1 `npm run typecheck` green.
- [x] 8.2 `npm run lint` clean in touched files.
- [x] 8.3 `npm run test` green; new tests passing; baseline of pre-existing skipped unchanged.
- [x] 8.4 Manual smoke: spawn two panes, alias one (`multiterm agent alias @reviewer`), `send-to` from the other, accept; create/claim/complete a task; `kv set`/`get`; reload renderer → chip and pending state survive.
- [x] 8.5 `npm run build:mac:unsigned` — verify `out/main/cli/index.cjs` exists, `~/.local/bin/multiterm` overwritten, and `app.asar` ships the CLI bundle.
