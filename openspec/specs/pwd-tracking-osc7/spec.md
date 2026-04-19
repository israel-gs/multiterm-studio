# pwd-tracking-osc7 Specification

## Purpose

Track each session's current working directory via the OSC 7 escape sequence emitted by the shell.

## Requirements

### Requirement: Shell hook injection

On session spawn, the sidecar MUST inject an OSC 7 hook appropriate for the shell. For zsh, injection MUST use a `ZSH_INTEGRATION_DIR` via `ZDOTDIR` plus a runtime hook. For bash or sh, a runtime hook MUST be written to the PTY after a 300 ms delay and MUST preserve any existing `PROMPT_COMMAND`. For fish, no hook is required (fish emits OSC 7 natively).

#### Scenario: zsh injection

- GIVEN a session whose shell is zsh
- WHEN the session is spawned
- THEN `ZDOTDIR` points at an integration directory AND the integration `.zshrc` sources the user's real zshrc AND `__collab_osc7` is appended to `precmd_functions`

#### Scenario: bash wraps existing PROMPT_COMMAND

- GIVEN a session whose shell is bash AND the user's bash sets `PROMPT_COMMAND="echo hi"`
- WHEN the runtime hook is injected
- THEN the final `PROMPT_COMMAND` emits OSC 7 AND then runs `echo hi`

#### Scenario: fish skipped

- GIVEN a session whose shell is fish
- WHEN the session is spawned
- THEN no runtime hook is injected AND no integration directory is used

### Requirement: OSC 7 parsing

The renderer MUST register an xterm.js OSC handler for identifier `7`. The handler MUST parse payloads of the form `file://<host><absolute-path>`, decode the path, and emit a `session.cwd-changed` event with `{ sessionId, cwd }`.

#### Scenario: Valid OSC 7

- GIVEN a terminal with the OSC 7 handler registered
- WHEN the PTY emits `\e]7;file://mac/Users/me/code\a`
- THEN an event is fired with `cwd = "/Users/me/code"`

#### Scenario: Malformed sequence

- GIVEN a terminal with the OSC 7 handler registered
- WHEN the PTY emits `\e]7;not-a-url\a`
- THEN no event is fired AND no error surfaces to the renderer

### Requirement: Fallback cwd

If no OSC 7 is received within 2 seconds of spawn, the session's reported cwd MUST fall back to the spawn cwd until a subsequent OSC 7 arrives.

#### Scenario: Shell without OSC 7

- GIVEN a session spawned with `cwd = "/home/me"` and a shell that never emits OSC 7
- WHEN 2 seconds elapse after spawn
- THEN the session's reported cwd is `/home/me`

#### Scenario: Late OSC 7 overrides fallback

- GIVEN the fallback cwd is `/home/me`
- WHEN the PTY emits `\e]7;file://host/tmp\a`
- THEN the reported cwd becomes `/tmp`
