# pane-agent-registry Specification

## Purpose

Registry of active panes (agents) known to the bridge. Handles auto-registration at pane spawn, alias assignment, and resolution of targets passed to messaging and other operations.

## Requirements

### Requirement: Auto-registration

When a pane is spawned with a `MULTITERM_PANE_ID` env var, the first CLI invocation from that pane MUST cause the bridge to register the pane if it is not already present. The registration record MUST capture `{ paneId, alias: null, createdAt, lastSeenAt }`.

#### Scenario: First invocation

- GIVEN a pane with `MULTITERM_PANE_ID = "pane-abc"` AND no registry entry exists
- WHEN a process inside that pane runs `multiterm agent list`
- THEN a new registry entry for `pane-abc` is created AND `lastSeenAt` is set to now AND the response includes `pane-abc` in the list

#### Scenario: Subsequent invocations update last-seen

- GIVEN a registered pane `pane-abc`
- WHEN a process inside that pane runs any `multiterm` command
- THEN the registry entry's `lastSeenAt` is updated to the current time

### Requirement: Alias assignment

Panes MAY assign themselves an alias via `bridge.agent.alias`. Aliases MUST be unique across active panes and MUST match the character class `[A-Za-z0-9_\-]+` prefixed by `@` (the prefix is mandatory in the CLI but stored without the `@`).

#### Scenario: Assign alias

- GIVEN pane `pane-abc` is registered with `alias = null`
- WHEN pane-abc calls `bridge.agent.alias` with `{ alias: "reviewer" }`
- THEN the entry's alias becomes `reviewer` AND the response is success

#### Scenario: Collision

- GIVEN alias `reviewer` is held by pane `pane-abc`
- WHEN pane `pane-xyz` calls `bridge.agent.alias` with `{ alias: "reviewer" }`
- THEN the response is JSON-RPC error `-32021` `AliasCollision`

#### Scenario: Clear alias

- GIVEN pane `pane-abc` has alias `reviewer`
- WHEN pane-abc calls `bridge.agent.alias` with `{ alias: null }`
- THEN the entry's alias becomes null AND the alias `reviewer` is available for other panes

#### Scenario: Invalid alias format

- GIVEN any registered pane
- WHEN it calls `bridge.agent.alias` with `{ alias: "has space" }`
- THEN the response is JSON-RPC error `-32602` `Invalid params`

### Requirement: Target resolution

When any bridge method refers to a target pane by string, the resolver MUST accept either the raw `paneId` (e.g. `pane-abc`) or an alias with the leading `@` (e.g. `@reviewer`). If neither resolves to an active registered pane, the call MUST fail with `-32020` `PaneNotFound`.

#### Scenario: Resolve by alias

- GIVEN alias `reviewer` is held by pane `pane-abc`
- WHEN any pane calls `bridge.send` with `{ to: "@reviewer", ... }`
- THEN the resolver delivers the message to `pane-abc`

#### Scenario: Resolve by id

- GIVEN pane `pane-abc` is registered
- WHEN any pane calls `bridge.send` with `{ to: "pane-abc", ... }`
- THEN the resolver delivers the message to `pane-abc`

#### Scenario: Missing target

- GIVEN no pane has alias `ghost` AND no pane has id `ghost`
- WHEN any pane calls `bridge.send` with `{ to: "@ghost", ... }`
- THEN the response is JSON-RPC error `-32020` `PaneNotFound`

### Requirement: Deregistration

When a pane is killed (via `pty:kill` or app shutdown), the registry MUST mark the entry inactive and release its alias so that new panes may claim it.

#### Scenario: Kill releases alias

- GIVEN alias `reviewer` is held by pane `pane-abc`
- WHEN `pane-abc` is killed
- THEN the entry is marked inactive AND a new pane `pane-xyz` can successfully call `bridge.agent.alias` with `{ alias: "reviewer" }`

### Requirement: Listing

`bridge.agent.list` MUST return all ACTIVE registered panes ordered by `lastSeenAt` descending. The response MUST include `paneId`, `alias`, `createdAt`, and `lastSeenAt`. Inactive panes MUST NOT appear.

#### Scenario: List active only

- GIVEN three panes registered, one of which has been killed
- WHEN any pane calls `bridge.agent.list`
- THEN the response contains exactly the two active entries
