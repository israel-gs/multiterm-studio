# pane-bridge Specification

## Purpose

In-process daemon inside Electron main that serves the `multiterm` CLI over a local socket. Dispatches JSON-RPC requests to the messaging, task-queue, KV, and agent-registry subsystems.

## Requirements

### Requirement: Daemon lifecycle

The bridge daemon MUST start with the Electron main process unless a Setting disables it. When disabled, incoming connections MUST be rejected with JSON-RPC error `-32010` (`BridgeDisabled`).

#### Scenario: Default start

- GIVEN the Setting `bridge.enabled` is true (default)
- WHEN Electron main finishes startup
- THEN a bridge socket at `~/.multiterm-studio/bridge.sock` is listening AND accepts connections

#### Scenario: Disabled at startup

- GIVEN the Setting `bridge.enabled` is false
- WHEN Electron main finishes startup
- THEN the bridge socket is not created AND any CLI invocation returns exit code 4

#### Scenario: Clean shutdown

- GIVEN a running bridge daemon with an in-flight `send-to`
- WHEN Electron main begins `before-quit`
- THEN the in-flight call receives a JSON-RPC error with code `-32011` (`BridgeShutdown`) AND the socket file is removed within 1 second

### Requirement: Transport and framing

The bridge socket MUST use `makeEndpointPath("bridge")` for its endpoint. The wire format MUST be newline-delimited JSON-RPC 2.0, one request per line, matching the sidecar protocol.

#### Scenario: Socket path

- GIVEN `process.platform === "darwin"`
- WHEN the bridge is listening
- THEN the socket file is located at `~/.multiterm-studio/bridge.sock`

#### Scenario: Malformed request

- GIVEN a connected client
- WHEN the client sends a line that is not valid JSON-RPC
- THEN the server replies with a JSON-RPC error `-32700` (`Parse error`) AND keeps the connection open

### Requirement: Method namespace

All bridge methods MUST live under the `bridge.*` prefix. Unknown methods MUST return JSON-RPC error `-32601`. The minimum supported methods are:

| Method                 | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `bridge.send`          | Synchronous send-to with accept/decline       |
| `bridge.notify`        | Async fire-and-forget notification            |
| `bridge.task.create`   | Create a task                                 |
| `bridge.task.claim`    | Claim a pending task                          |
| `bridge.task.complete` | Complete a claimed task                       |
| `bridge.task.release`  | Release a claimed task back to pending        |
| `bridge.task.fail`     | Mark a claimed task as failed (terminal)      |
| `bridge.task.list`     | List tasks filtered by status                 |
| `bridge.kv.set`        | Set a KV pair                                 |
| `bridge.kv.get`        | Get a KV value                                |
| `bridge.kv.del`        | Delete a KV key                               |
| `bridge.kv.list`       | List KV keys with optional prefix             |
| `bridge.agent.list`    | List registered agents                        |
| `bridge.agent.alias`   | Assign or clear the alias of the calling pane |

#### Scenario: Unknown method

- GIVEN a connected CLI client
- WHEN the request method is `bridge.unknown.thing`
- THEN the response is JSON-RPC error `-32601`

### Requirement: Error code range

Bridge-specific JSON-RPC errors MUST use codes in the range `-32000` to `-32099` with a stable table:

| Code   | Name                 |
| ------ | -------------------- |
| -32000 | Generic bridge error |
| -32010 | BridgeDisabled       |
| -32011 | BridgeShutdown       |
| -32020 | PaneNotFound         |
| -32021 | AliasCollision       |
| -32030 | TaskNotFound         |
| -32031 | TaskStateInvalid     |
| -32040 | DeclinedByUser       |
| -32041 | Timeout              |
| -32050 | KVKeyInvalid         |

#### Scenario: Stable error codes

- GIVEN any client invokes `bridge.send` with a non-existent target pane
- THEN the response is a JSON-RPC error with code `-32020` AND message mentions the missing target

### Requirement: Concurrency and queueing

The daemon MUST handle multiple concurrent client connections. Method dispatch within a single pane is serialized (one in-flight request per sender) to keep state transitions predictable.

#### Scenario: Parallel clients

- GIVEN two distinct panes each invoke `bridge.kv.set` concurrently
- WHEN both requests arrive within a few milliseconds
- THEN both responses are sent successfully AND both values are persisted
