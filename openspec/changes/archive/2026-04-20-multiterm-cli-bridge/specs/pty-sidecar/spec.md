# Delta for pty-sidecar

## MODIFIED Requirements

### Requirement: Session control protocol

The sidecar MUST expose a JSON-RPC 2.0 control endpoint supporting `session.create`, `session.write`, `session.resize`, `session.kill`, and `session.replay`. Unknown methods MUST return JSON-RPC error `-32601` (Method not found). `session.create` MUST accept an optional `env: Record<string, string>` parameter whose entries are merged into the spawned PTY's environment on top of the sidecar's own `process.env`.

(Previously: `session.create` did not expose an `env` parameter; the spawned PTY inherited only the sidecar's `process.env`.)

#### Scenario: Create session

- GIVEN a connected control client
- WHEN it sends `{method: "session.create", params: {shell, cwd, cols, rows, initialCommand?: string, env?: Record<string, string>}}`
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
- AND `env` (if present in params) is NOT re-applied — the original environment is preserved

#### Scenario: Env merge on create

- GIVEN a `session.create` call with `env = { MULTITERM_PANE_ID: "pane-abc", CUSTOM_VAR: "x" }`
- WHEN the PTY is spawned
- THEN `MULTITERM_PANE_ID` and `CUSTOM_VAR` are present in the PTY's environment AND they override any same-named entry from the sidecar's `process.env`

#### Scenario: Env absent on create

- GIVEN a `session.create` call without an `env` field
- WHEN the PTY is spawned
- THEN the PTY inherits only the sidecar's `process.env`
