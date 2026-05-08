# pane-task-queue Specification

## Purpose

Shared task queue accessible from any pane via the bridge. Enables work-claim coordination patterns across agents.

## Requirements

### Requirement: Task creation

Any registered pane MAY create a task. A task MUST have a unique `id` (server-assigned), a `name` (caller-supplied), an optional `body`, a `createdBy` pane reference, a `createdAt` timestamp, and an initial status of `pending`.

#### Scenario: Create task

- GIVEN pane A is registered
- WHEN pane A calls `bridge.task.create` with `{ name: "fix-login" }`
- THEN the response includes the assigned `id` AND the status is `pending` AND `createdBy` references pane A

#### Scenario: Empty name rejected

- GIVEN pane A is registered
- WHEN pane A calls `bridge.task.create` with `{ name: "" }`
- THEN the response is JSON-RPC error `-32602` `Invalid params`

### Requirement: Task state machine

A task MUST transition between the following states: `pending` → `claimed` → (`completed` | `released` | `failed`). `released` transitions a task back to `pending` so that another pane can claim it. Transitions not in this graph MUST fail with `-32031` `TaskStateInvalid`.

#### Scenario: Valid transition

- GIVEN a task in status `claimed` owned by pane A
- WHEN pane A calls `bridge.task.complete` with its id
- THEN the task status becomes `completed` AND the response is success

#### Scenario: Invalid transition

- GIVEN a task in status `pending`
- WHEN any pane calls `bridge.task.complete` on it
- THEN the response is JSON-RPC error `-32031`

### Requirement: Ownership rules

Only the pane that claimed a task MAY complete, release, or fail it. Any pane MAY claim a pending task. The server MUST atomically transition `pending → claimed` and record the claiming pane.

#### Scenario: Atomic claim

- GIVEN a task in status `pending` AND two panes A and B both call `bridge.task.claim`
- WHEN the two claim requests arrive within a few milliseconds
- THEN exactly one claim succeeds AND the other receives JSON-RPC error `-32031` `TaskStateInvalid`

#### Scenario: Non-owner cannot complete

- GIVEN a task claimed by pane A
- WHEN pane B calls `bridge.task.complete` on it
- THEN the response is JSON-RPC error `-32001` `NotOwner`

### Requirement: Listing

`bridge.task.list` MUST accept optional filters `{ status?: string | string[]; ownedBy?: string }` and return an array of task records ordered by `createdAt` ascending. If no filter is given, all tasks are returned.

#### Scenario: Filter by status

- GIVEN the queue contains 3 pending and 2 completed tasks
- WHEN any pane calls `bridge.task.list` with `{ status: "pending" }`
- THEN the response lists exactly the 3 pending tasks

### Requirement: Persistence

Task records MUST be persisted such that they survive app restart. State transitions MUST be written within the same transaction as the request that triggered them.

#### Scenario: Survives restart

- GIVEN pane A claimed task `T`
- WHEN the app is quit AND restarted
- THEN `bridge.task.list` returns `T` with status `claimed` AND `ownedBy` still references pane A's id
