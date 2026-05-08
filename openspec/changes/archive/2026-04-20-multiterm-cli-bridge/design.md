# Design: multiterm CLI bridge for pane-to-pane orchestration

## Technical Approach

A bridge module under `src/main/bridge/` runs inside the Electron main process, listens on a stable Unix socket / Named Pipe, and serves JSON-RPC 2.0 requests from a CLI binary installed at `~/.local/bin/multiterm`. State (agents, messages, tasks, KV) lives in SQLite via `better-sqlite3`. Pane identity is delivered to each shell via a new optional `env` parameter on the sidecar's `session.create`. Cross-pane messages surface in the renderer as a chip on the `FloatingCard` header that opens a modal.

## Architecture Decisions

| #   | Decision           | Choice                                                                         | Alternatives                                                   | Rationale                                                                                                                                                                                       |
| --- | ------------------ | ------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Daemon location    | Module inside Electron main                                                    | Separate sidecar process                                       | The bridge needs the same lifecycle as the renderer; no benefit to isolating it like the PTY (which exists for renderer-restart survival). Mirrors `rpcServer.ts`.                              |
| 2   | Storage            | `better-sqlite3`                                                               | `@sqlite.org/sqlite-wasm`, JSON file                           | Sync API matches Electron main usage; battle-tested; native rebuild already a solved problem (`node-pty` does it). WASM forces async + worker complexity. JSON file fails on concurrent writes. |
| 3   | Socket path        | `~/.multiterm-studio/bridge.sock` (stable)                                     | Pid-suffixed like `rpcServer`                                  | The CLI cannot discover a pid before connecting. Stable name is the contract.                                                                                                                   |
| 4   | CLI binary         | Node CJS bundle at `resources/multiterm-cli.cjs`, installer schema bumped      | Compiled binary via `pkg`/`esbuild`; keep current shell script | CJS bundle is small, trivially built by electron-vite. `pkg` adds toolchain + native-deps headaches. Current shell script must be replaced anyway (it only opens the app).                      |
| 5   | Identity injection | `MULTITERM_PANE_ID` via `SessionCreateParams.env` (sidecar protocol extension) | `export MULTITERM_PANE_ID=...` written to PTY after spawn      | Protocol extension is a one-time clean change. Writing `export` after spawn leaks into shell history and races with shell startup.                                                              |
| 6   | Auto-start         | Default ON, Settings toggle                                                    | Opt-in                                                         | The bridge is the feature; making it opt-in hides it. Toggle exists for users who want it off.                                                                                                  |
| 7   | Accept/decline UI  | Chip on `FloatingCard` header + modal                                          | Global inbox sidebar                                           | Spatially correct ("this pane has a message"). Inbox adds nav surface for v1.                                                                                                                   |
| 8   | Schema migrations  | `schema_version` table + numbered up-only migrations in code                   | None / external tool                                           | Embedded approach matches single-user desktop reality.                                                                                                                                          |

## Data Flow — `send-to`

```
multiterm CLI (pane A) ─ JSON-RPC ─→ bridge.sock ─→ dispatcher ─→ messaging
                                                                       │
                                                                       ▼
                                                            insert message (SQLite)
                                                                       │
                                                                       ▼
                                                  IPC → renderer "bridge:pending+1"
                                                                       │
                                                                       ▼
                                                  Chip renders on pane B header
                                                                       │
                                                                       ▼
                                                  User clicks Accept/Decline in modal
                                                                       │
                                                                       ▼
                                                  IPC → main "bridge:accept" / "bridge:decline"
                                                                       │
                                                                       ▼
                                                  Pending Promise resolves → success / error
                                                                       │
                                                                       ▼
                                                  CLI prints result, exits 0/6
```

## File Changes

| File                                                 | Action   | Description                                                   |
| ---------------------------------------------------- | -------- | ------------------------------------------------------------- |
| `src/main/bridge/server.ts`                          | New      | Socket server + JSON-RPC dispatcher                           |
| `src/main/bridge/db.ts`                              | New      | `better-sqlite3` connection + `schema_version` migrations     |
| `src/main/bridge/messaging.ts`                       | New      | `send-to` / `notify` + pending-promise registry               |
| `src/main/bridge/tasks.ts`                           | New      | Task state machine                                            |
| `src/main/bridge/kv.ts`                              | New      | KV operations                                                 |
| `src/main/bridge/registry.ts`                        | New      | Agent registry + alias resolution                             |
| `src/main/bridge/protocol.ts`                        | New      | Method names, error codes, request/response types             |
| `src/main/bridge/cli/index.cjs`                      | New      | CLI source compiled to `resources/multiterm-cli.cjs`          |
| `electron.vite.config.ts`                            | Modified | Add CLI bundle build entry                                    |
| `src/main/cliInstaller.ts`                           | Modified | Bump schema; install `multiterm-cli.cjs` + thin launcher      |
| `src/main/sidecar/protocol.ts`                       | Modified | `SessionCreateParams.env?: Record<string, string>`            |
| `src/main/sidecar/server.ts`                         | Modified | Merge `env` into `pty.spawn` env                              |
| `src/main/ptyManager.ts`                             | Modified | Pass `{ MULTITERM_PANE_ID: id }` in `client.create`           |
| `src/main/index.ts`                                  | Modified | Boot bridge after sidecar; shutdown on `before-quit`          |
| `src/main/settingsManager.ts`                        | Modified | `bridge.enabled` getter/setter                                |
| `src/preload/index.{ts,d.ts}`                        | Modified | `bridgePending`, `bridgeAccept`, `bridgeDecline`              |
| `src/renderer/src/store/bridgeStore.ts`              | New      | Per-pane pending counts                                       |
| `src/renderer/src/components/FloatingCard.tsx`       | Modified | Render chip when pending > 0                                  |
| `src/renderer/src/components/MessageAcceptModal.tsx` | New      | Accept/decline UI                                             |
| `src/renderer/src/components/SettingsPanel.tsx`      | Modified | Bridge toggle in Terminal section                             |
| `electron-builder.yml`                               | Modified | Native rebuild + ship `multiterm-cli.cjs` in `extraResources` |
| `package.json`                                       | Modified | Add `better-sqlite3`                                          |

## Interfaces / Contracts

SQLite schema (v1):

```sql
CREATE TABLE schema_version (version INTEGER PRIMARY KEY);

CREATE TABLE agents (
  pane_id     TEXT PRIMARY KEY,
  alias       TEXT UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  from_pane   TEXT NOT NULL,
  to_pane     TEXT NOT NULL,
  body        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('send','notify')),
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  body        TEXT,
  created_by  TEXT NOT NULL,
  owned_by    TEXT,
  status      TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

## Testing Strategy

| Layer       | What                                                                   | Approach                                                |
| ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Unit        | `db.ts`, `protocol.ts`, `registry` resolver, KV constraints, task FSM  | vitest with in-memory `:memory:` SQLite                 |
| Integration | bridge server end-to-end via real Unix socket; CLI ↔ daemon round-trip | spawn the CLI via `child_process` against a test daemon |
| Renderer    | Chip + modal interactions                                              | `@testing-library/react`                                |

## Migration / Rollout

- `cliInstaller` bumps schema from 1 → 2 and force-overwrites `~/.local/bin/multiterm`. No user action required.
- Sidecar protocol extension is backward compatible (`env` is optional).
- DB is created on first daemon boot. No migration from prior versions.

## Open Questions

None. All defaults locked during exploration and proposal phases.
