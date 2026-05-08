# Proposal: multiterm CLI bridge for pane-to-pane orchestration

## Intent

Give agents, shells, and scripts running in separate Multiterm Studio panes a first-class way to communicate. Agent-agnostic successor to Claude Code Team Agents (tmux-mediated, removed in v1.2.0). Unlocks coordination patterns — messaging, task claims, shared memory — that today require out-of-band channels.

## Scope

### In Scope

- `multiterm` CLI binary, Node CJS bundle at `resources/multiterm-cli.cjs`, installed by an upgraded `cliInstaller.ts`.
- Bridge daemon inside Electron main on `~/.multiterm-studio/bridge.sock`. JSON-RPC 2.0 framing.
- Pane messaging: `send-to` (sync, requires accept) and `notify` (async). Chip on pane header + modal for accept/decline.
- Task queue: `task create/claim/complete/list/release`. State: pending → claimed → completed / released / failed.
- KV shared memory: `kv set/get/del/list`. Scalar string values.
- Agent registry: auto-registration at pane spawn. `agent list`, `agent alias @name`.
- `MULTITERM_PANE_ID` env var injected via `SessionCreateParams.env` extension in sidecar.
- SQLite persistence via `better-sqlite3` at `~/.multiterm-studio/bridge.db`.
- Settings toggle: "Enable Multiterm Bridge" (default ON).

### Out of Scope

- Remote or cross-machine bridging.
- Structured payloads beyond plain text in v1.
- Global inbox sidebar (chip + modal is the v1 UI).
- Message encryption; data stays on local filesystem.

## Capabilities

### New Capabilities

- `multiterm-cli`: CLI binary, install flow, invocation model, env var contract, exit codes.
- `pane-bridge`: daemon lifecycle, socket transport, JSON-RPC namespace, error codes.
- `pane-messaging`: `send-to` / `notify` semantics, accept/decline UI, timeout behavior.
- `pane-task-queue`: task operations, state transitions, ownership.
- `pane-kv-store`: KV operations, size and key constraints.
- `pane-agent-registry`: auto-registration, alias uniqueness, resolution.

### Modified Capabilities

- `pty-sidecar`: `SessionCreateParams` gains an optional `env: Record<string, string>` field merged into the spawned PTY environment.

## Approach

The daemon runs as a module inside the Electron main process, same pattern as `rpcServer`. It binds a stable Unix socket / Named Pipe via `makeEndpointPath("bridge")`. The CLI is a Node CJS bundle; each invocation opens a short-lived connection, exchanges JSON-RPC, prints the result, and exits. State lives in SQLite with a `schema_version` table for migrations. `MULTITERM_PANE_ID` is injected at PTY spawn via the extended sidecar protocol.

## Affected Areas

| Area                                                 | Impact   | Description                                 |
| ---------------------------------------------------- | -------- | ------------------------------------------- |
| `src/main/bridge/`                                   | New      | Daemon, JSON-RPC dispatcher, SQLite layer   |
| `resources/multiterm-cli.cjs`                        | New      | CLI binary bundle                           |
| `src/main/cliInstaller.ts`                           | Modified | Bump installer schema, rewrite the CLI file |
| `src/main/sidecar/{protocol,server}.ts`              | Modified | Accept optional `env` in `session.create`   |
| `src/main/ptyManager.ts`                             | Modified | Pass `MULTITERM_PANE_ID` via `env`          |
| `src/renderer/src/components/FloatingCard.tsx`       | Modified | Chip on pane header when message pending    |
| `src/renderer/src/components/MessageAcceptModal.tsx` | New      | Accept/decline modal                        |
| `src/renderer/src/components/SettingsPanel.tsx`      | Modified | Bridge on/off toggle                        |
| `electron-builder.yml`                               | Modified | Native rebuild for `better-sqlite3`         |
| `package.json`                                       | Modified | Add `better-sqlite3` dependency             |

## Risks

| Risk                                                           | Likelihood | Mitigation                                                                   |
| -------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| `better-sqlite3` native rebuild fails on some host             | Med        | Reuse node-pty rebuild path; verify in CI                                    |
| Existing `~/.local/bin/multiterm` shell script not overwritten | Med        | Bump installer schema; force rewrite on next launch                          |
| Long `send-to` blocks caller indefinitely                      | Med        | Default 60 s timeout; `--timeout` flag override                              |
| Accept modal steals focus from active pane                     | Low        | Modal non-blocking; keyboard shortcut for accept                             |
| DB file corruption                                             | Low        | SQLite WAL mode + transactions; backup + recreate is the documented recovery |

## Rollback Plan

Change lives on `feat/multiterm-cli-bridge`. Revert the merge commit to restore the pre-bridge state. Data stored in `bridge.db` is lost; no reverse migration is provided (documented in release notes).

## Dependencies

- `better-sqlite3` (npm).
- Sidecar protocol extension (see Modified Capabilities).

## Success Criteria

- [ ] `multiterm send-to @alias "message"` delivers a chip to the target pane; accept returns success on the caller.
- [ ] `multiterm task create/claim/complete/list/release` round-trips through the daemon.
- [ ] `multiterm kv set/get` persists across app restart.
- [ ] `multiterm agent list` returns all active panes with their IDs and aliases.
- [ ] Settings toggle disables the daemon; CLI returns a `bridge-disabled` exit code.
- [ ] `npm run test`, `npm run typecheck`, and `npm run lint` are all green.
