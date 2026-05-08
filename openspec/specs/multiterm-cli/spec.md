# multiterm-cli Specification

## Purpose

Command-line binary shipped with Multiterm Studio. Any process running inside a pane can invoke it to interact with the bridge daemon.

## Requirements

### Requirement: Installation

The app MUST install the CLI as an executable named `multiterm` in a user-writable directory on `PATH`. When an older version of the CLI already exists at that path, the installer MUST overwrite it, keyed by an internal schema version.

#### Scenario: Fresh install

- GIVEN no `multiterm` binary exists at `~/.local/bin/`
- WHEN the app launches for the first time
- THEN `~/.local/bin/multiterm` is written AND is executable (chmod +x)

#### Scenario: Upgrade from earlier schema

- GIVEN `~/.local/bin/multiterm` exists AND its stored schema version is lower than the current installer's schema
- WHEN the app launches
- THEN the file is overwritten with the current CLI content AND the schema version is updated

### Requirement: Invocation contract

Each invocation MUST be short-lived: open a connection to the bridge daemon, issue one JSON-RPC request, print the response, and exit. The exit code MUST be `0` on success, non-zero on any error, with distinct codes per class (see table below).

| Exit code | Meaning                                     |
| --------- | ------------------------------------------- |
| 0         | Success                                     |
| 1         | Generic error (unclassified)                |
| 2         | Usage error (bad flags, unknown subcommand) |
| 3         | Bridge not reachable (daemon down)          |
| 4         | Bridge disabled in Settings                 |
| 5         | Target pane / alias / task / key not found  |
| 6         | Declined by user                            |
| 7         | Timeout                                     |

#### Scenario: Missing daemon

- GIVEN the bridge daemon is not running
- WHEN the user runs `multiterm send-to @x "hi"`
- THEN the CLI prints a clear error to stderr AND exits with code 3

#### Scenario: Invalid subcommand

- GIVEN any environment
- WHEN the user runs `multiterm bogus`
- THEN the CLI prints a usage hint to stderr AND exits with code 2

### Requirement: Environment identity

The CLI MUST read `MULTITERM_PANE_ID` from its environment to identify the calling pane. If the variable is unset AND the subcommand requires pane identity, the CLI MUST exit with code 2 and a hint that the command must run inside a Multiterm pane.

#### Scenario: Identity present

- GIVEN `MULTITERM_PANE_ID = "pane-abc"` in the environment
- WHEN the user runs `multiterm agent list`
- THEN the request includes `from = "pane-abc"` as the sender

#### Scenario: Identity absent

- GIVEN `MULTITERM_PANE_ID` is not set in the environment
- WHEN the user runs `multiterm send-to @x "hi"`
- THEN the CLI exits with code 2 AND the stderr message mentions that the command must run inside a Multiterm pane

### Requirement: Subcommand surface

The CLI MUST expose at minimum these top-level subcommands: `send-to`, `notify`, `task`, `kv`, `agent`, `help`, `version`. Each subcommand with operands MUST accept `-h` / `--help` and print a concise usage.

#### Scenario: Help subcommand

- GIVEN any environment
- WHEN the user runs `multiterm help task`
- THEN usage for `task create/claim/complete/list/release` is printed to stdout AND the exit code is 0

### Requirement: Output mode

Output MUST default to a human-readable single-line or small-table format. A global `--json` flag MUST switch output to a machine-readable JSON document describing the result.

#### Scenario: JSON output

- GIVEN the bridge contains three active panes
- WHEN the user runs `multiterm agent list --json`
- THEN stdout contains a single JSON array of agent objects AND nothing else before exit
