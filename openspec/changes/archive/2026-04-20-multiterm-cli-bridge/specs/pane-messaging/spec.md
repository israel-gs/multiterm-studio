# pane-messaging Specification

## Purpose

Cross-pane messaging primitives: synchronous `send-to` with user consent, and asynchronous `notify` for informational pushes.

## Requirements

### Requirement: Synchronous send-to

A `bridge.send` request MUST block the caller until the user of the target pane accepts, declines, or the request times out. The response payload MUST be one of:

- success with optional response text (accept)
- JSON-RPC error `-32040` `DeclinedByUser`
- JSON-RPC error `-32041` `Timeout`

#### Scenario: Accept

- GIVEN pane A calls `bridge.send` with target `@b` and body `"hi"`
- WHEN the user of pane B clicks Accept in the modal within the timeout (no reply text entered)
- THEN pane A receives a success response with `{ response: null }`

#### Scenario: Accept with response text

- GIVEN pane A calls `bridge.send` with target `@b` and body `"hi"`
- WHEN the user of pane B types `"got it"` in the modal reply field AND clicks Accept
- THEN pane A receives a success response with `{ response: "got it" }`

#### Scenario: Decline

- GIVEN pane A calls `bridge.send` with target `@b`
- WHEN the user of pane B clicks Decline
- THEN pane A receives JSON-RPC error `-32040`

#### Scenario: Accept of orphan message (no live pending entry)

- GIVEN a message with status `pending` exists in the DB AND no in-memory pending promise tracks it (because the original caller exited or the bridge restarted)
- WHEN the renderer calls `bridge:accept` with that messageId
- THEN the DB row's status becomes `accepted` AND `response_text` is persisted
- AND no error is raised AND no in-memory promise is resolved

#### Scenario: Decline of orphan message (no live pending entry)

- GIVEN a message with status `pending` exists in the DB AND no in-memory pending promise tracks it (because the original caller exited or the bridge restarted)
- WHEN the renderer calls `bridge:decline` with that messageId
- THEN the DB row's status becomes `declined`
- AND no error is raised AND no in-memory promise is resolved

#### Scenario: Timeout

- GIVEN pane A calls `bridge.send` with `timeoutMs = 60000`
- WHEN 60 seconds elapse without accept or decline
- THEN pane A receives JSON-RPC error `-32041` AND the pending chip on pane B's header disappears

### Requirement: Asynchronous notify

A `bridge.notify` request MUST return immediately with a delivery acknowledgement. The target pane's header MUST still display a chip, but no user consent is required and the notification is marked auto-accepted in the log.

#### Scenario: Notify delivered

- GIVEN pane A calls `bridge.notify` with target `@b` and body `"build done"`
- WHEN the daemon receives the request
- THEN pane A receives a success response within 100 ms AND pane B shows a chip in its header

#### Scenario: Notify to missing target

- GIVEN no pane has alias `@x`
- WHEN any pane calls `bridge.notify` with target `@x`
- THEN the response is JSON-RPC error `-32020` `PaneNotFound`

### Requirement: Timeout default and override

`bridge.send` MUST default to 60 000 ms when the caller omits `timeoutMs`. The caller MAY pass any integer between 1 000 and 3 600 000 ms inclusive; values outside the range MUST be clamped.

#### Scenario: Default timeout

- GIVEN a `bridge.send` request with no `timeoutMs` field
- WHEN the daemon dispatches it
- THEN the effective timeout is 60 000 ms

#### Scenario: Clamped to maximum

- GIVEN a `bridge.send` request with `timeoutMs = 86400000` (24 h)
- WHEN the daemon dispatches it
- THEN the effective timeout is `3600000` (1 h)

### Requirement: Accept/decline UI

The target pane MUST display a chip on its FloatingCard header whenever one or more `bridge.send` or `bridge.notify` messages are pending. Clicking the chip MUST open a modal listing the pending messages with Accept and Decline actions per row.

#### Scenario: Chip renders

- GIVEN pane B has two pending messages
- WHEN the user views the canvas
- THEN the header of pane B shows a chip with count `2`

#### Scenario: Modal accepts

- GIVEN pane B has a pending `bridge.send` from pane A
- WHEN the user clicks the chip AND clicks Accept on that row
- THEN the modal row disappears AND pane A's in-flight call resolves with success

#### Scenario: Notify auto-clears

- GIVEN pane B has a pending `bridge.notify`
- WHEN 30 seconds elapse without user interaction
- THEN the chip count decrements by one AND the notification is marked auto-dismissed in the log

### Requirement: Persistence of message log

Every message (send-to or notify), its state transitions, and its final outcome MUST be persisted in the bridge database. Pending messages MUST survive app restart: on startup, panes with pending inbound messages MUST still show their chip.

#### Scenario: Restart mid-send

- GIVEN pane A has a pending `bridge.send` to pane B AND the app is forcibly quit
- WHEN the app restarts AND pane B is reopened from persisted layout
- THEN the chip reappears on pane B's header AND the message row shows status `pending`
- AND the original caller (pane A) has exited — the message remains `pending` (no in-memory promise exists); the chip re-appears via rehydration; if the user accepts, the DB row is updated to `accepted` even though the original caller is gone

### Requirement: Pending-message rehydration

The renderer MUST be able to query the bridge for currently `pending` messages so the chip state can be rebuilt after a renderer reload. The bridge MUST expose this query as a renderer-side IPC method (not part of the JSON-RPC namespace consumed by the CLI), and the response MUST include all fields the renderer needs to render the chip and modal.

#### Scenario: Renderer rehydrates after reload

- GIVEN one message with status `pending` exists in the DB targeting pane B
- WHEN the renderer mounts and calls `bridgeListPending()`
- THEN the response contains exactly that message AND the chip on pane B's header re-appears

#### Scenario: Idempotent dedup by messageId

- GIVEN the renderer's bridge store already contains a message with `messageId = X`
- WHEN `bridgePendingReceived` is called again with `messageId = X`
- THEN the store remains unchanged (no duplicate row in the modal)
