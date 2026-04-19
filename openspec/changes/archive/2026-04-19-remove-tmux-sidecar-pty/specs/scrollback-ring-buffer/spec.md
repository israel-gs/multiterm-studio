# scrollback-ring-buffer Specification

## Purpose

Bounded in-memory scrollback per session, used by the sidecar to replay output on renderer reconnect.

## Requirements

### Requirement: Bounded capacity

Each session MUST have its own ring buffer with a configurable byte cap. The default cap MUST be 8 MB. The cap MUST be configurable between 16 KB (minimum) and 64 MB (maximum) via app settings. When the cap is reached, the oldest bytes MUST be overwritten first.

#### Scenario: Writes within cap

- GIVEN an empty buffer with cap 8 MB
- WHEN 4 MB of bytes are written
- THEN a replay returns exactly those 4 MB in write order

#### Scenario: Overflow wraps

- GIVEN a buffer with cap 1 MB containing 1 MB of bytes
- WHEN 256 KB of new bytes are written
- THEN a replay returns the most recent 1 MB AND the earliest 256 KB are gone

#### Scenario: Configured cap

- GIVEN `settings.scrollbackBytes = 2_097_152` (2 MB)
- WHEN a new session is created
- THEN its ring buffer cap is 2 MB

### Requirement: Replay API

The ring buffer MUST expose a `replay()` operation returning the current contents as a single byte sequence in write order.

#### Scenario: Replay after writes

- GIVEN writes of `"A"`, `"B"`, `"C"` in that order
- WHEN `replay()` is called
- THEN the returned sequence equals `"ABC"`

#### Scenario: Replay on empty buffer

- GIVEN a buffer with no writes
- WHEN `replay()` is called
- THEN the returned sequence is empty (length 0)

### Requirement: Per-session isolation

Each session's ring buffer MUST be independent. Writes to one session MUST NOT appear in another session's replay.

#### Scenario: Isolation

- GIVEN sessions A and B with separate ring buffers
- WHEN `"hello"` is written to A
- THEN `replay()` on B returns an empty sequence
