# Exploration: multiterm-cli-bridge

> Artifact store: openspec
> Date: 2026-04-18
> Branch: feat/multiterm-cli-bridge

---

## Current State

Multiterm Studio already has a working local RPC infrastructure. Key facts discovered from reading the codebase:

- `src/main/rpcServer.ts` — JSON-RPC 2.0 server over a Unix socket at `/tmp/multiterm-studio-{pid}.sock`. Writes its socket path to `~/.multiterm-studio/socket-path` for discovery. Already registers methods: `agent.*`, `pane.*`, `app.notify`, `rpc.discover`, `ping`.
- `src/main/sidecar/protocol.ts` — `makeEndpointPath(name)` helper generates `~/.multiterm-studio/{name}.sock` (or Windows named pipe). Already used by the PTY sidecar.
- `src/main/cliInstaller.ts` — installs a shell launcher script to `~/.local/bin/multiterm` on first app launch. Currently only a thin `open -a "Multiterm Studio" --args "$DIR"` wrapper — it must be replaced/complemented with a real binary that speaks JSON-RPC.
- `src/main/ptyManager.ts` — manages PTY sessions. Knows session IDs but does NOT inject env vars into spawned PTYs; env is inherited from the shell.
- `src/main/hookInjector.ts` — shows how Claude Code hooks read `~/.multiterm-studio/socket-path` and fire short-lived JSON-RPC connections per invocation. This is exactly the connection model we should replicate for the `multiterm` CLI.
- `src/main/attentionService.ts` — shows precedent for cross-pane UI notifications (native OS notification + `panel:focus` IPC). Accept/decline UI for bridge messages is a natural extension of this pattern.
- `src/renderer/src/components/CardHeader.tsx` — header chip slots already exist (`attention-badge-inline`, `agent-active-dot`). Adding an "incoming message" indicator is straightforward.
- `src/preload/index.ts` — contextBridge surface is the IPC gateway between renderer and main. Every new bridge push channel needs an entry here.
- `src/renderer/src/store/panelStore.ts` — per-panel metadata store. Bridge state (incoming message pending, alias) belongs here or in a new dedicated `bridgeStore.ts`.
- No SQLite dependency exists today. `better-sqlite3` or `@sqlite.org/sqlite-wasm` would need to be added as a new dependency. `better-sqlite3` is the natural choice for Electron main process (native Node addon).

---

## Affected Areas

| File / Module                                    | Why affected                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `src/main/rpcServer.ts`                          | Add `bridge.*` method namespace; or create a separate `bridgeServer.ts` alongside  |
| `src/main/cliInstaller.ts`                       | Replace launcher script with (or augment by) a Node.js script that speaks JSON-RPC |
| `src/main/ptyManager.ts`                         | Inject `MULTITERM_PANE_ID` env var at session spawn (PTY `create` call)            |
| `src/main/sidecar/protocol.ts`                   | `makeEndpointPath()` reuse for bridge socket path                                  |
| `src/main/index.ts`                              | Start bridge daemon at `app.whenReady()`; stop at `before-quit`                    |
| `src/main/settingsManager.ts`                    | Bridge auto-start toggle, message retention setting                                |
| `src/main/attentionService.ts`                   | Model for cross-pane notification delivery                                         |
| `src/preload/index.ts`                           | Expose bridge push channels to renderer                                            |
| `src/renderer/src/store/panelStore.ts`           | Add bridge inbox state (pending messages per pane)                                 |
| `src/renderer/src/components/CardHeader.tsx`     | Render incoming-message chip                                                       |
| `src/renderer/src/components/TerminalCanvas.tsx` | Render accept/decline modal or toast                                               |
| New: `src/main/bridgeServer.ts`                  | Bridge daemon: agents/messages/tasks/kv; SQLite-backed                             |
| New: `src/main/bridgeDb.ts`                      | SQLite schema, migrations, typed query layer                                       |
| New: `resources/multiterm-cli.cjs`               | Bundled CLI binary (replaces current shell script)                                 |

---

## Sub-Question Analysis

---

### 1. JSON-RPC Method Naming

**Recommendation**: Use dot-namespaced groups with consistent verb-noun order. Prefix all bridge methods with `bridge.` to avoid collision with existing `pane.*` / `agent.*` / `app.*` methods already in `rpcServer.ts`.

| Method                  | Description                                                   | Returns                                    |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------------ |
| `bridge.send`           | Sync send-to: delivers message, waits for user accept/decline | `{ accepted: boolean, messageId: string }` |
| `bridge.notify`         | Async fire-and-forget notify                                  | `{ messageId: string }`                    |
| `bridge.task.create`    | Create a new task                                             | `{ taskId: string }`                       |
| `bridge.task.claim`     | Claim a pending task                                          | `{ ok: boolean }`                          |
| `bridge.task.complete`  | Mark claimed task complete                                    | `{ ok: boolean }`                          |
| `bridge.task.release`   | Release a claimed task back to pending                        | `{ ok: boolean }`                          |
| `bridge.task.fail`      | Mark task failed with optional reason                         | `{ ok: boolean }`                          |
| `bridge.task.list`      | List tasks with optional filter                               | `{ tasks: Task[] }`                        |
| `bridge.kv.set`         | Set a KV entry                                                | `{ ok: boolean }`                          |
| `bridge.kv.get`         | Get a KV entry                                                | `{ value: string \| null }`                |
| `bridge.kv.del`         | Delete a KV entry                                             | `{ ok: boolean }`                          |
| `bridge.kv.list`        | List KV entries with optional prefix                          | `{ entries: KVEntry[] }`                   |
| `bridge.agent.list`     | List registered agents                                        | `{ agents: Agent[] }`                      |
| `bridge.agent.alias`    | Set alias for self                                            | `{ ok: boolean }`                          |
| `bridge.agent.register` | Register self (auto-called on first CLI op)                   | `{ agentId: string }`                      |

**Option A — Flat `bridge.*`** (recommended): easy to discover, consistent with existing pattern in `rpcServer.ts`, avoids nested grouping ambiguity.

**Option B — Grouped `bridge.messaging.*`, `bridge.tasks.*`**: more self-documenting but adds a level of nesting that makes `rpc.discover` output harder to read.

---

### 2. Request Timeouts for `send-to`

**Options**:

| Timeout                                | Trade-off                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------- |
| 30 s                                   | Too short if user stepped away briefly                                    |
| 60 s (recommended default)             | Reasonable for an interactive accept; user is likely watching their panes |
| 300 s                                  | Too long; CLI process blocks; agent hangs without feedback                |
| Configurable via `--timeout <seconds>` | Best of all worlds                                                        |

**Recommendation**: default 60 s, configurable per-call via `--timeout <seconds>` flag. The daemon stores the timeout on the pending message record; a background timer resolves the pending RPC with error code `-32010` (see §3) on expiry.

---

### 3. Error Model

Reserve the range `-32099` to `-32000` for application-defined errors (JSON-RPC 2.0 spec allows this range). Use a sub-range for bridge:

| Code     | Name                          | Meaning                                         |
| -------- | ----------------------------- | ----------------------------------------------- |
| `-32000` | Generic server error          | Catch-all (existing in rpcServer.ts)            |
| `-32010` | `BRIDGE_TIMEOUT`              | send-to waiting on user accept timed out        |
| `-32011` | `BRIDGE_DECLINED`             | User explicitly declined the message            |
| `-32012` | `BRIDGE_PANE_NOT_FOUND`       | Target pane ID or alias does not exist          |
| `-32013` | `BRIDGE_ALIAS_COLLISION`      | Alias already taken by another agent            |
| `-32014` | `BRIDGE_TASK_NOT_FOUND`       | Task ID does not exist                          |
| `-32015` | `BRIDGE_TASK_STATE_INVALID`   | Transition not allowed from current state       |
| `-32016` | `BRIDGE_KV_KEY_INVALID`       | Key contains disallowed characters              |
| `-32017` | `BRIDGE_DAEMON_UNAVAILABLE`   | Daemon not running and auto-start disabled      |
| `-32018` | `BRIDGE_AGENT_NOT_REGISTERED` | Pane not registered (env var missing)           |
| `-32019` | `BRIDGE_SHUTDOWN`             | In-flight request cancelled due to app shutdown |

---

### 4. Connection Model

**Options**:

| Model                                                   | Pros                                                                                  | Cons                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Short-lived connection per CLI invocation (recommended) | Matches existing hook pattern in `hookInjector.ts`; no connection pool needed; simple | Slight overhead per call (~1-2 ms on local socket — negligible) |
| Persistent connection / pool                            | Faster for batch calls                                                                | Complex; CLI processes typically run once and exit              |

**Daemon not running behavior**:

- **Option A — Auto-start**: daemon starts as a child of the Electron app, not independently. CLI cannot auto-start Electron. If daemon is not running, CLI should fail fast with a clear message.
- **Option B — Fail with hint** (recommended): CLI exits code 1, prints `multiterm daemon not running — open Multiterm Studio to start it.`

**Socket path discovery**: CLI reads `~/.multiterm-studio/socket-path` (same file `rpcServer.ts` already writes). This is the existing pattern — no changes needed to discovery.

**Important caveat**: the current `rpcServer.ts` writes the socket at `/tmp/multiterm-studio-{pid}.sock` but the discovery file is at `~/.multiterm-studio/socket-path`. The bridge daemon needs its OWN stable socket, separate from the existing RPC server, so that:

1. It can survive across window re-creates.
2. It holds the SQLite connection.

**Recommendation**: create `bridgeServer.ts` as a module started from `index.ts`, listening on `makeEndpointPath('bridge')` = `~/.multiterm-studio/bridge.sock`. The existing `rpcServer.ts` stays for agent hooks; the bridge gets its own socket. The CLI binary reads `~/.multiterm-studio/bridge.sock` directly (constant path, not pid-dependent).

---

### 5. SQLite Schema

No SQLite dependency exists today. Add `better-sqlite3` (native, synchronous API ideal for Electron main process) + `@types/better-sqlite3`.

**Migration strategy**: `schema_version` table; migrations are numbered SQL files applied sequentially at startup.

```sql
-- schema_version
CREATE TABLE IF NOT EXISTS schema_version (
  version  INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- agents
CREATE TABLE agents (
  id         TEXT PRIMARY KEY,           -- auto-assigned UUID: pane-<uuid>
  alias      TEXT UNIQUE,               -- user-defined @alias, nullable
  pane_id    TEXT NOT NULL,             -- session ID from ptyManager
  registered_at TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX idx_agents_pane ON agents(pane_id);

-- messages
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  from_agent   TEXT NOT NULL REFERENCES agents(id),
  to_agent     TEXT NOT NULL REFERENCES agents(id),
  kind         TEXT NOT NULL CHECK(kind IN ('send', 'notify')),
  body         TEXT NOT NULL,           -- JSON string (v1: plain text in "text" field)
  content_type TEXT NOT NULL DEFAULT 'text/plain',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','accepted','declined','expired')),
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
CREATE INDEX idx_messages_to   ON messages(to_agent, status);
CREATE INDEX idx_messages_from ON messages(from_agent);

-- tasks
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  created_by   TEXT NOT NULL REFERENCES agents(id),
  claimed_by   TEXT REFERENCES agents(id),
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK(status IN ('pending','claimed','completed','released','failed')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  metadata     TEXT                    -- JSON blob for future extensions
);
CREATE INDEX idx_tasks_status ON tasks(status);

-- kv
CREATE TABLE kv (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  set_by       TEXT NOT NULL REFERENCES agents(id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

**File location**: `~/.multiterm-studio/bridge.db`

---

### 6. Message Retention Policy

**Options**:

| Policy                        | Pros                                      | Cons                                |
| ----------------------------- | ----------------------------------------- | ----------------------------------- |
| Forever                       | Simple; complete audit trail              | DB grows unbounded; privacy concern |
| 30 days (recommended default) | Reasonable for debugging; bounded size    | Requires background vacuum job      |
| 7 days                        | Lighter; matches typical session duration | May lose relevant history           |
| User-configurable             | Most flexible                             | Implementation complexity           |

**Recommendation**: 30-day default, configurable via `settings.bridge.messageRetentionDays`. A background timer in the bridge daemon runs a `DELETE FROM messages WHERE resolved_at < datetime('now', '-N days')` cleanup once per app launch.

---

### 7. Task State Machine

```
         create
           |
           v
        [pending]
           |
      claim(agent)
           |
           v
        [claimed]
        /   |   \
 complete release fail
    |        |     |
    v        v     v
[completed] [pending] [failed]
```

**Ownership rules**:

- Any registered agent can claim any `pending` task (open work queue model).
- Only the claiming agent can `complete` or `fail` their own claimed task.
- Any agent can `release` a claimed task (returns it to pending) — this supports supervisor patterns where a coordinator reclaims stuck tasks.
- The creating agent can `cancel` a pending task (transition to `failed` with reason `cancelled`) — not exposed in v1 but reserved in schema via `metadata`.

**Transitions table**:

| From      | Action        | To          | Who                 |
| --------- | ------------- | ----------- | ------------------- |
| `pending` | `claim`       | `claimed`   | Any agent           |
| `claimed` | `complete`    | `completed` | Claiming agent only |
| `claimed` | `fail`        | `failed`    | Claiming agent only |
| `claimed` | `release`     | `pending`   | Any agent           |
| `pending` | (auto-expire) | `failed`    | Daemon (future)     |

---

### 8. Accept/Decline UI Location

**Options**:

| Option                                             | Pros                                                | Cons                              |
| -------------------------------------------------- | --------------------------------------------------- | --------------------------------- |
| Modal over target pane only                        | Focused; clear context                              | Missed if user is in another pane |
| Global inbox panel                                 | Aggregated; never missed                            | Requires new UI surface           |
| Chip on pane header + modal on click (recommended) | Non-blocking; user sees indicator; clicks to review | Slightly more implementation work |

**Recommendation**: chip on the target pane's `CardHeader` (reuse the attention-badge slot pattern already there) + a small modal/popover rendered within `TerminalCanvas` when the chip is clicked. The chip should show the sender alias and message preview (first 40 chars). For `notify` (fire-and-forget), show a toast at the top of the target pane's card for 3 s with no action required.

The incoming notification reaches the renderer via a new IPC push channel: `bridge:incoming` (main → renderer), carrying `{ messageId, fromAlias, preview, kind }`. The renderer updates the `bridgeStore` and `panelStore` to set an `incomingMessage` flag on the target pane.

---

### 9. Message Content Types

**v1**: plain text only. Body is stored as JSON: `{ "text": "your message here" }`. The `content_type` column defaults to `text/plain`.

**Reserved shape for future**:

```json
{
  "text": "optional plain text",
  "json": {
    /* arbitrary object */
  },
  "attachment": { "name": "file.txt", "size": 1024, "path": "/tmp/..." }
}
```

The CLI `--message` flag and stdin pipe accept raw text in v1. The daemon wraps it in the envelope before storing.

---

### 10. Bulk Notifications

If multiple messages arrive at the target pane simultaneously:

**Options**:

| Approach                                    | Pros          | Cons                          |
| ------------------------------------------- | ------------- | ----------------------------- |
| Stack (show all chips)                      | User sees all | UI clutter on the card header |
| Batch (show "N messages from X agents")     | Clean         | Loses individual context      |
| Block (only one pending at a time per pane) | Simplest      | Senders queue or fail         |

**Recommendation**: stack up to 3 message chips on the pane header (sorted by arrival). If more than 3 are pending, collapse to "3+ messages" chip that opens a mini-inbox modal listing all pending. For `notify` toasts, show them sequentially with 500 ms delay between each (no stacking).

---

### 11. Daemon Location

**Options**:

| Option                                            | Pros                                                                                                          | Cons                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Module inside Electron main process (recommended) | Single process; direct access to `ipcMain`; no IPC needed to reach renderer; matches how `rpcServer.ts` works | Crashes in the daemon crash the main process                                           |
| Separate sidecar process (like PTY sidecar)       | Isolated; restartable                                                                                         | Adds another child process; cross-process IPC needed to push notifications to renderer |

**Recommendation**: run as a module inside the Electron main process (same pattern as `rpcServer.ts`). The bridge daemon is lightweight (SQLite reads/writes + socket server). Crashing risk is low. Starting it as a sidecar would require the notification push path to be: bridge sidecar → IPC to main → `win.webContents.send()` to renderer — unnecessary complexity.

---

### 12. Auto-Start

**Options**:

| Option                               | Description                                            |
| ------------------------------------ | ------------------------------------------------------ |
| Always start with app (recommended)  | Simplest; bridge is always available; minimal overhead |
| Only when first pane registers       | Deferred; no cost if never used                        |
| Never until user enables in Settings | Opt-in; safest privacy posture                         |

**Recommendation**: always start with app (matches how `rpcServer.ts` starts today). Add a Settings toggle `bridge.enabled` (default: true) for users who want to disable entirely. If disabled, CLI commands fail with `-32017 BRIDGE_DAEMON_UNAVAILABLE`. Expose the toggle in the existing `SettingsPanel.tsx`.

---

### 13. Shutdown Behavior

When `app.before-quit` fires:

1. Bridge daemon marks all `pending` (waiting for accept) message records as `status = 'expired'`, `resolved_at = now`.
2. All in-flight `bridge.send` RPC connections that have not yet received a response get an error response: code `-32019`, message `"Multiterm Studio is shutting down"`.
3. The bridge daemon closes its socket, then `bridgeDb` closes the SQLite connection cleanly.
4. Order in `before-quit`: rpcServer cleanup → bridge cleanup → sidecar disconnect (same as current shutdown sequence, bridge inserted before sidecar).

This ensures senders receive a clean error instead of a socket drop.

---

### 14. Complete CLI Verb Reference

All commands exit 0 on success, non-zero on error. JSON output via `--json` flag.

```
multiterm send-to <target> --message <text> [--timeout <s>]
  target: pane ID or @alias
  Exit 0: message accepted
  Exit 1: declined (stderr: "Message declined by user")
  Exit 2: timeout (stderr: "Timed out after Ns waiting for acceptance")
  Exit 3: target not found
  stdout (--json): {"accepted":true,"messageId":"..."}

multiterm notify <target> --message <text>
  Fire-and-forget. Exit 0 always if message queued.
  stdout (--json): {"messageId":"..."}

multiterm task create --title <text> [--description <text>]
  stdout: task ID (or JSON)
  Exit 0: created

multiterm task claim <taskId>
  Exit 0: claimed
  Exit 1: task not found or already claimed

multiterm task complete <taskId>
  Exit 0: completed
  Exit 1: not claimed by you / not found

multiterm task release <taskId>
  Exit 0: released
  Exit 1: not found

multiterm task fail <taskId> [--reason <text>]
  Exit 0: marked failed

multiterm task list [--status pending|claimed|completed|failed]
  stdout: table (human) or JSON array

multiterm kv set <key> <value>
  Exit 0: set

multiterm kv get <key>
  stdout: value (raw) or JSON {"value":"...","key":"..."}
  Exit 1: key not found (exit 0 with null in --json mode)

multiterm kv del <key>
  Exit 0: deleted (or not found — idempotent)

multiterm kv list [--prefix <prefix>]
  stdout: table or JSON array

multiterm agent list
  stdout: table or JSON array of {id, alias, paneId, lastSeen}

multiterm agent alias <@alias>
  Sets alias for the calling pane.
  Exit 0: set
  Exit 1: alias collision

multiterm ping
  stdout: "pong" or {"pong":true}
  Used for health check / daemon detection.

multiterm help [<command>]
  Prints usage. Subcommand help via: multiterm task help, etc.
```

---

### 15. Input Conventions

**Options**:

| Method                                  | Pros                         | Cons                       |
| --------------------------------------- | ---------------------------- | -------------------------- |
| `--message` flag only                   | Simple; no ambiguity         | Annoying for multi-line    |
| Piped stdin + `--message` (recommended) | Flexible; supports scripting | Need to detect TTY vs pipe |

**Recommendation**: accept both. If `--message` is provided, use it. If stdin is a pipe (`!process.stdin.isTTY`), read stdin as the message body. Multi-line content is supported via stdin. The daemon stores the full text verbatim.

```sh
echo "Deploy complete" | multiterm notify @reviewer
multiterm send-to @bob --message "Can you check the logs?"
```

---

### 16. Output Format

**Options**:

| Option                                               | Pros                                     | Cons                              |
| ---------------------------------------------------- | ---------------------------------------- | --------------------------------- |
| Human-readable default + `--json` flag (recommended) | Friendly for interactive use; scriptable | Slightly more output code         |
| JSON always                                          | Maximally scriptable                     | Hostile for interactive debugging |

**Recommendation**: human-readable default (colored where TTY supports it), `--json` global flag for machine consumption. Table output for list commands (align columns). Single-value outputs print the raw value (no labels) so they can be captured with `$(...)`.

---

### 17. Help and Discovery

**Recommendation**: use a subcommand-per-group model:

```
multiterm help                  — top-level summary
multiterm <command> --help      — command-specific help
multiterm task help             — task group help
```

The CLI binary itself is a Node.js script (bundled CJS) — use a minimal argument parser (no external deps, just manual `process.argv` parsing or a tiny helper). No `yargs`/`commander` needed — keeps the binary small and dependency-free. `rpc.discover` can be called to list available methods for dynamic help generation.

---

### 18. CLI Binary Shipping

**Existing mechanism**: `cliInstaller.ts` writes a shell script to `~/.local/bin/multiterm` at app launch. Currently only `open -a "Multiterm Studio"`.

**Options**:

| Option                                                     | Pros                                                                  | Cons                                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Replace shell script with Node.js CJS bundle (recommended) | Works without shell; can speak JSON-RPC directly; cross-platform path | Need to bundle; must ship Node or rely on system Node                  |
| Keep shell script, delegate to bundled binary              | Familiar pattern                                                      | Two files; fragile if path changes                                     |
| electron-builder `extraResources` + symlink at install     | Clean; no system Node dependency                                      | Requires `extraResources` packaging config; symlink needs install step |

**Recommendation**: ship the CLI as a Node.js CJS file bundled into `resources/multiterm-cli.cjs` via electron-vite (add to `extraResources` in `electron-builder.yml`). The `cliInstaller.ts` is updated to write a thin shell wrapper that calls `node /path/to/multiterm-cli.cjs "$@"` (or the Electron binary with `--cli` flag as an alternative). The `~/.local/bin/multiterm` script becomes:

```sh
#!/bin/sh
node "$(dirname $(readlink -f $0))/../lib/multiterm-cli.cjs" "$@"
```

However, since the resources path varies per platform, the simplest approach is: `cliInstaller.ts` writes the actual path to the bundled CJS file into the wrapper at install time.

**Alternative if Node is not reliable**: bundle the CLI using `pkg` or `esbuild --bundle --platform=node` into a self-contained binary, ship via `extraResources`. More robust but adds build complexity.

---

### 19. Env Var Injection (`MULTITERM_PANE_ID`)

**Injection point options**:

| Location                                              | Pros                                                      | Cons                                                                   |
| ----------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| `ptyManager.ts` in `pty:create` handler (recommended) | Already has session ID; natural place; no sidecar changes | Needs small change to pass env to sidecar                              |
| Sidecar `server.ts` in `session.create`               | Env lives closest to PTY spawn                            | Sidecar is a separate process; env injection API not currently exposed |
| `hookInjector.ts`                                     | Co-located with other env-like injections                 | hookInjector manages files, not envs                                   |

**Current flow**: `ptyManager.ts` calls `client.create({ sessionId, shell, cwd, ... })`. The sidecar's `server.ts` calls `pty.spawn(shell, [], { cwd, env: process.env, ... })`. The `env` parameter is currently inherited from the sidecar's `process.env`.

**Recommendation**: extend the `SessionCreateParams` in `sidecar/protocol.ts` to include optional `env?: Record<string, string>`. `ptyManager.ts` passes `{ MULTITERM_PANE_ID: id }` merged with `process.env`. The sidecar merges it when spawning the PTY. This is a clean, minimal change.

**Alternate (simpler, no sidecar change)**: inject via OSC sequence — immediately after PTY creation, send a shell command that sets the variable: `export MULTITERM_PANE_ID=<id>`. This is fragile (visible in history, timing-sensitive). DO NOT use.

---

### 20. Agent Alias Persistence

**Options**:

| Location                     | Pros                                                 | Cons                                                           |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| Bridge DB only (recommended) | Single source of truth; survives restarts; queryable | Requires DB to be running at read time                         |
| App settings only            | Fast read; no DB dependency                          | Lost if settings file corrupted; not queryable by other agents |
| Both (hybrid)                | Redundant safety net                                 | Two places to keep in sync                                     |

**Recommendation**: bridge DB only. The `agents` table has a `UNIQUE` alias column. When the user runs `multiterm agent alias @reviewer`, the bridge daemon executes `UPDATE agents SET alias = '@reviewer' WHERE id = ?` with a uniqueness check. The CLI and the renderer can query the DB (renderer via IPC, CLI via bridge socket). No duplication needed.

---

## Approaches Summary

### Option A — Extend `rpcServer.ts` with `bridge.*` methods

Add all bridge methods directly to the existing RPC server. Share the same socket.

- Pros: one socket, simpler discovery, no new server.
- Cons: the existing socket path is pid-dependent (`/tmp/multiterm-studio-{pid}.sock`) — the CLI cannot hardcode it. Bridge state (SQLite) tied to the main RPC lifecycle. Any crash or restart loses pending message state.

### Option B — Standalone `bridgeServer.ts` module (recommended)

Separate module, own socket at `~/.multiterm-studio/bridge.sock` (stable path), own SQLite connection. Started from `index.ts` at `app.whenReady()`.

- Pros: stable discovery path (no pid); bridge state decoupled from agent hook server; clear separation of concerns; CLI hardcodes `~/.multiterm-studio/bridge.sock`.
- Cons: two Unix sockets running; slight additional resource use (negligible).

**Effort**: Medium (new module, SQLite dep, new CLI binary, preload additions, renderer bridgeStore).

### Option C — Sidecar process for bridge

Run bridge as a separate child process (like the PTY sidecar).

- Pros: fully isolated.
- Cons: cross-process notification push is complex (bridge sidecar → Electron main IPC → renderer); no meaningful benefit given the daemon's lightweight nature.

---

## Recommendation

**Use Option B** (standalone `bridgeServer.ts` in main process). Key decisions:

1. Bridge daemon runs as a module in Electron main, starts always at `app.whenReady()`, listens on the stable path `~/.multiterm-studio/bridge.sock`.
2. CLI is a Node.js CJS bundle (`resources/multiterm-cli.cjs`) installed by an updated `cliInstaller.ts`. Reads `bridge.sock` directly.
3. `MULTITERM_PANE_ID` is injected via extending `SessionCreateParams.env` in the sidecar protocol — cleanest path, minimal diff.
4. Accept/decline UI uses pane-header chip (reuses existing attention slot) + a modal that renders within `TerminalCanvas`. No global inbox in v1.
5. `better-sqlite3` as SQLite driver (native, synchronous, best Electron compatibility).
6. Alias persistence: bridge DB only.
7. Message retention: 30 days default.
8. In-flight `send-to` calls on shutdown resolve with error `-32019` (not silent drop).

---

## Risks

- `better-sqlite3` is a native addon — it requires rebuild for each Electron version. Must be added to `electron-builder` `nativeRebuilder` config. This is the most operationally significant risk (build pipeline change).
- The current `cliInstaller.ts` silently fails on non-macOS. The new CLI binary must handle Windows named pipes for cross-platform parity, or explicitly document macOS-only for v1.
- `MULTITERM_PANE_ID` injection via `SessionCreateParams.env` requires a sidecar protocol change — both `protocol.ts` and `server.ts` in the sidecar need updating. This is a simple additive change but touches the PTY hot path.
- Alias uniqueness across panes: if two panes race to claim the same alias, the DB `UNIQUE` constraint is the guard. The CLI must surface the `-32013` error clearly.
- The accept/decline UI on `CardHeader` uses a chip slot that is already used by `attention-badge-inline` and `agent-active-dot`. A third concurrent indicator (incoming message) needs careful visual design to avoid crowding.

---

## Ready for Proposal

Yes. All 20 sub-questions have concrete answers with trade-offs and recommendations. The architecture is coherent with the existing codebase. One user decision needed before `sdd-new`: see Top Decisions below.
