# pane-kv-store Specification

## Purpose

Shared scalar key-value memory accessible from any pane via the bridge. Supports lightweight coordination state (flags, pointers, small configuration values) across agents.

## Requirements

### Requirement: Scalar operations

The bridge MUST support `bridge.kv.set`, `bridge.kv.get`, `bridge.kv.del`, and `bridge.kv.list`. Each operation is atomic with respect to concurrent callers.

#### Scenario: Set then get

- GIVEN no key `feature.flag` exists
- WHEN pane A calls `bridge.kv.set` with `{ key: "feature.flag", value: "enabled" }`
- AND pane B calls `bridge.kv.get` with `{ key: "feature.flag" }`
- THEN pane B receives `{ value: "enabled" }`

#### Scenario: Get missing key

- GIVEN no key `unknown` exists
- WHEN any pane calls `bridge.kv.get` with `{ key: "unknown" }`
- THEN the response is `{ value: null }` (NOT an error)

#### Scenario: Delete existing key

- GIVEN key `x` exists
- WHEN pane A calls `bridge.kv.del` with `{ key: "x" }`
- THEN the response is `{ deleted: true }` AND subsequent `bridge.kv.get` returns `{ value: null }`

#### Scenario: Delete missing key

- GIVEN no key `x` exists
- WHEN pane A calls `bridge.kv.del` with `{ key: "x" }`
- THEN the response is `{ deleted: false }` (NOT an error)

### Requirement: Key constraints

Keys MUST be non-empty strings up to 256 bytes of UTF-8 encoded length. Keys MUST match the character class `[A-Za-z0-9._:/\-]+`. Invalid keys MUST return JSON-RPC error `-32050` `KVKeyInvalid`.

#### Scenario: Key too long

- GIVEN a pane calls `bridge.kv.set` with a key of 257 bytes
- WHEN the server dispatches the request
- THEN the response is JSON-RPC error `-32050`

#### Scenario: Key with disallowed character

- GIVEN a pane calls `bridge.kv.set` with `{ key: "foo bar", value: "x" }`
- WHEN the server dispatches the request
- THEN the response is JSON-RPC error `-32050` (space is not in the allowed class)

### Requirement: Value constraints

Values MUST be strings up to 64 KiB of UTF-8 encoded length. Callers that need larger or binary data SHOULD store it outside the KV store and keep only a reference here.

#### Scenario: Value too large

- GIVEN a pane calls `bridge.kv.set` with a 65 KiB value
- WHEN the server dispatches the request
- THEN the response is JSON-RPC error `-32602` `Invalid params` with a message citing the 64 KiB limit

### Requirement: Listing

`bridge.kv.list` MUST accept an optional `{ prefix?: string }` filter and return an array of `{ key, value }` pairs sorted by key ascending. When no prefix is supplied, all keys are returned.

#### Scenario: Prefix filter

- GIVEN the store holds keys `a.1`, `a.2`, `b.1`
- WHEN any pane calls `bridge.kv.list` with `{ prefix: "a." }`
- THEN the response contains exactly two entries: `a.1` and `a.2`

### Requirement: Persistence

KV entries MUST be persisted such that they survive app restart. `set` and `del` MUST complete durably before the response is returned.

#### Scenario: Survives restart

- GIVEN pane A called `bridge.kv.set` with `{ key: "x", value: "1" }` and received success
- WHEN the app is quit AND restarted
- THEN `bridge.kv.get` for key `x` returns `{ value: "1" }`
