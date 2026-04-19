# pty-sidecar Specification

## Purpose

Out-of-process node-pty host. Isolates PTY lifecycle from Electron main and allows the renderer to restart while sessions keep running.

## Requirements

### Requirement: Sidecar lifecycle

Electron main MUST spawn exactly one sidecar process at app startup and MUST write its PID to `{collab_dir}/sidecar.pid`. The sidecar MUST be shut down cleanly when Electron quits.

#### Scenario: Startup

- GIVEN no sidecar is running
- WHEN Electron main starts
- THEN a sidecar is spawned AND a PID file is written AND the control endpoint accepts connections within 3 seconds

#### Scenario: Clean shutdown

- GIVEN a running sidecar
- WHEN Electron main begins quit
- THEN the sidecar receives a shutdown signal AND exits within 2 seconds AND the PID file is removed

#### Scenario: Startup failure

- GIVEN the control endpoint cannot be bound
- WHEN Electron main starts
- THEN the user is shown a fatal error dialog AND no partial PID file remains

### Requirement: Session control protocol

The sidecar MUST expose a JSON-RPC 2.0 control endpoint supporting `session.create`, `session.write`, `session.resize`, `session.kill`, and `session.replay`. Unknown methods MUST return JSON-RPC error `-32601` (Method not found).

#### Scenario: Create session

- GIVEN a connected control client
- WHEN it sends `{method: "session.create", params: {shell, cwd, cols, rows, initialCommand?: string}}`
- THEN the response contains a `sessionId` AND a data endpoint path AND a session data socket is listening

#### Scenario: Hook precedes initialCommand

- GIVEN a `session.create` call with `shell = "/bin/zsh"` and `initialCommand = "claude"`
- WHEN the session is created on a zsh host
- THEN the OSC 7 hook is written to the PTY BEFORE the initial command
- AND no write races into the TUI started by the initial command

#### Scenario: Unknown method

- GIVEN a connected control client
- WHEN it sends a method not in the supported set
- THEN the response is a JSON-RPC error with code `-32601`

#### Scenario: Create with existing sessionId is idempotent

- GIVEN a session `X` already exists in the sidecar
- WHEN a client sends `{ method: "session.create", params: { sessionId: "X", ... } }`
- THEN the response is a success with `{ sessionId: "X", dataEndpoint }` matching the existing session
- AND no new PTY is spawned
- AND `initialCommand` (if present in params) is NOT re-executed — only the first `session.create` triggers the hook and command writes

### Requirement: Per-session data transport

Each session MUST have a dedicated bidirectional data endpoint separate from the control endpoint. Bytes written to the endpoint MUST be forwarded to the PTY input; PTY output MUST be streamed to connected data clients.

#### Scenario: Bidirectional flow

- GIVEN an active session with a connected data client
- WHEN the client writes `"echo hi\n"`
- THEN the PTY stdout stream on the data endpoint includes `"hi"`

### Requirement: Cross-platform endpoint path

Endpoint paths MUST resolve via a `makeEndpointPath(name)` helper that returns a Unix socket path on macOS/Linux and a Named Pipe path on Windows.

#### Scenario: Per-platform resolution

- GIVEN `process.platform === "darwin"`
- WHEN `makeEndpointPath("sidecar")` is called
- THEN the return value matches `~/.multiterm-studio/sidecar.sock`

#### Scenario: Windows pipe

- GIVEN `process.platform === "win32"`
- WHEN `makeEndpointPath("sidecar")` is called
- THEN the return value matches `\\.\pipe\multiterm-sidecar`

### Requirement: Renderer reconnection

A renderer MUST be able to reconnect to an existing session's data endpoint by `sessionId` after the renderer process restarts. A reconnect MUST trigger a full scrollback replay before new PTY output is streamed.

#### Scenario: Reconnect restores scrollback

- GIVEN a session with 1 MB of prior output
- WHEN the renderer restarts and reconnects by `sessionId`
- THEN the first bytes received are the full scrollback AND live PTY output follows uninterrupted

#### Scenario: Unknown session id

- GIVEN no session exists with `sessionId = "x"` AND the data socket file for `"x"` does not exist
- WHEN a client attempts to connect to the data endpoint for `"x"`
- THEN the connection attempt MUST fail with an OS-level error (typically `ECONNREFUSED` or `ENOENT`)
- AND the client MUST treat the error as a non-fatal signal that the session is absent

Rationale: data sockets only exist after a successful `session.create`. The OS connection error is the canonical "session not found" signal for data-plane reconnect attempts. Control-plane calls (`session.write`, `session.resize`, etc.) still return the JSON-RPC `-32000` "Session not found" error.
