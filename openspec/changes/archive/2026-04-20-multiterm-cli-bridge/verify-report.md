# Verification Report — multiterm-cli-bridge

**Change**: `multiterm-cli-bridge`
**Artifact store**: `openspec`
**Mode**: Strict TDD
**Date**: 2026-04-20

---

## Completeness

| Metric           | Value |
| ---------------- | ----- |
| Tasks total      | 41    |
| Tasks complete   | 41    |
| Tasks incomplete | 0     |

All tasks in `tasks.md` are `[x]`. Phase 8 verification items are closed.

---

## Build & Tests Execution

**Typecheck**: FAILED (1 NEW error in change scope; rest pre-existing)

- NEW: `src/renderer/src/App.tsx(196,8): error TS2551: Property 'bridgeListPending' does not exist on type '...'`.
- Root cause: `src/renderer/src/env.d.ts` duplicates the renderer's `electronAPI` declaration and was NOT updated when `bridgeListPending` was added during smoke. The correct preload type in `src/preload/index.d.ts` does include it, but `tsconfig.web.json` augments with `env.d.ts` which overrides, dropping the method.
- Other typecheck errors (`TerminalCanvas.tsx`, `WelcomeScreen.tsx`, `updateStore.ts`, etc.) are in files NOT modified by this change and pre-date it — baseline regressions unrelated to the bridge.

**Lint**: FAILED (17 errors, 48 warnings) — most in files outside this change. Within change scope:

- `tests/renderer/MessageAcceptModal.test.tsx` — prettier formatting warnings only.
- `tests/renderer/bridgeStore.test.ts` — prettier formatting warnings only.
- No lint ERRORS introduced by this change in its own files.

**Tests**: 467 passed / 0 failed / 9 skipped across 30 test files. Duration 10.9 s.

**Coverage**: Not collected (no threshold configured).

---

## Spec Compliance Matrix (behavioral evidence)

### `multiterm-cli`

| Requirement          | Scenario                    | Test                              | Result    |
| -------------------- | --------------------------- | --------------------------------- | --------- |
| Installation         | Fresh install               | `tests/main/cliInstaller.test.ts` | COMPLIANT |
| Installation         | Upgrade from earlier schema | `tests/main/cliInstaller.test.ts` | COMPLIANT |
| Invocation contract  | Missing daemon              | `tests/main/bridge/cli.test.ts`   | COMPLIANT |
| Invocation contract  | Invalid subcommand          | `tests/main/bridge/cli.test.ts`   | COMPLIANT |
| Environment identity | Identity present            | `tests/main/bridge/cli.test.ts`   | COMPLIANT |
| Environment identity | Identity absent             | `tests/main/bridge/cli.test.ts`   | COMPLIANT |
| Subcommand surface   | Help subcommand             | `tests/main/bridge/cli.test.ts`   | COMPLIANT |
| Output mode          | JSON output                 | `tests/main/bridge/cli.test.ts`   | COMPLIANT |

### `pane-bridge`

| Requirement           | Scenario                        | Test                                           | Result    |
| --------------------- | ------------------------------- | ---------------------------------------------- | --------- |
| Daemon lifecycle      | Default start                   | `tests/main/bridge/server.test.ts`             | COMPLIANT |
| Daemon lifecycle      | Disabled at startup             | `tests/main/bridge/server.test.ts`             | COMPLIANT |
| Daemon lifecycle      | Clean shutdown (BridgeShutdown) | `tests/main/bridge/server.test.ts`             | COMPLIANT |
| Transport and framing | Socket path                     | `tests/main/bridge/server.test.ts`             | COMPLIANT |
| Transport and framing | Malformed request (-32700)      | `tests/main/bridge/server.test.ts`             | COMPLIANT |
| Method namespace      | Unknown method (-32601)         | `tests/main/bridge/server.test.ts`             | COMPLIANT |
| Error code range      | Stable error codes (-32020)     | `tests/main/bridge/server.test.ts` + messaging | COMPLIANT |
| Concurrency           | Parallel clients                | `tests/main/bridge/server.test.ts`             | COMPLIANT |

### `pane-messaging`

| Requirement                  | Scenario                  | Test                                                          | Result             |
| ---------------------------- | ------------------------- | ------------------------------------------------------------- | ------------------ |
| Synchronous send-to          | Accept                    | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Synchronous send-to          | Accept with response text | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Synchronous send-to          | Decline (-32040)          | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Synchronous send-to          | Timeout (-32041)          | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Asynchronous notify          | Notify delivered          | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Asynchronous notify          | Notify to missing target  | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Timeout default and override | Default 60s / clamp to 1h | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Accept/decline UI            | Chip renders with count   | `tests/renderer/MessageAcceptModal.test.tsx` + FloatingCard   | COMPLIANT (static) |
| Accept/decline UI            | Modal accepts             | `tests/renderer/MessageAcceptModal.test.tsx`                  | COMPLIANT          |
| Accept/decline UI            | Notify auto-clears        | `tests/main/bridge/messaging.test.ts`                         | COMPLIANT          |
| Persistence of message log   | Restart mid-send          | `tests/main/bridge/messaging.test.ts` (orphan-accept/decline) | PARTIAL            |

### `pane-task-queue`

| Requirement        | Scenario                           | Test                              | Result    |
| ------------------ | ---------------------------------- | --------------------------------- | --------- |
| Task creation      | Create task                        | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Task creation      | Empty name rejected                | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Task state machine | Valid transition                   | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Task state machine | Invalid transition                 | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Ownership rules    | Atomic claim                       | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Ownership rules    | Non-owner cannot complete (-32001) | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Listing            | Filter by status                   | `tests/main/bridge/tasks.test.ts` | COMPLIANT |
| Persistence        | Survives restart                   | `tests/main/bridge/tasks.test.ts` | COMPLIANT |

### `pane-kv-store`

| Requirement       | Scenario                       | Test                           | Result    |
| ----------------- | ------------------------------ | ------------------------------ | --------- |
| Scalar operations | Set then get                   | `tests/main/bridge/kv.test.ts` | COMPLIANT |
| Scalar operations | Get missing key                | `tests/main/bridge/kv.test.ts` | COMPLIANT |
| Scalar operations | Delete existing/missing key    | `tests/main/bridge/kv.test.ts` | COMPLIANT |
| Key constraints   | Key too long / disallowed char | `tests/main/bridge/kv.test.ts` | COMPLIANT |
| Value constraints | Value too large                | `tests/main/bridge/kv.test.ts` | COMPLIANT |
| Listing           | Prefix filter                  | `tests/main/bridge/kv.test.ts` | COMPLIANT |
| Persistence       | Survives restart               | `tests/main/bridge/kv.test.ts` | COMPLIANT |

### `pane-agent-registry`

| Requirement       | Scenario                        | Test                                                     | Result    |
| ----------------- | ------------------------------- | -------------------------------------------------------- | --------- |
| Auto-registration | First invocation                | `tests/main/bridge/registry.test.ts` + server dispatcher | COMPLIANT |
| Auto-registration | Subsequent last-seen            | `tests/main/bridge/registry.test.ts`                     | COMPLIANT |
| Alias assignment  | Assign/collide/clear/invalid    | `tests/main/bridge/registry.test.ts`                     | COMPLIANT |
| Target resolution | Resolve by alias / id / missing | `tests/main/bridge/registry.test.ts`                     | COMPLIANT |
| Deregistration    | Kill releases alias             | `tests/main/bridge/registry.test.ts` unit only           | PARTIAL   |
| Listing           | List active only                | `tests/main/bridge/registry.test.ts`                     | COMPLIANT |

### `pty-sidecar` (delta)

| Requirement              | Scenario                           | Test                                | Result    |
| ------------------------ | ---------------------------------- | ----------------------------------- | --------- |
| Session control protocol | Create session                     | `tests/main/sidecar/server.test.ts` | COMPLIANT |
| Session control protocol | Hook precedes initialCommand       | `tests/main/sidecar/server.test.ts` | COMPLIANT |
| Session control protocol | Unknown method                     | `tests/main/sidecar/server.test.ts` | COMPLIANT |
| Session control protocol | Idempotent with existing sessionId | `tests/main/sidecar/server.test.ts` | COMPLIANT |
| Session control protocol | Env merge on create                | `tests/main/sidecar/server.test.ts` | COMPLIANT |
| Session control protocol | Env absent on create               | `tests/main/sidecar/server.test.ts` | COMPLIANT |

**Compliance summary**: 45 / 47 scenarios fully compliant; 2 PARTIAL.

---

## Correctness (Static — Structural Evidence)

| Requirement                                                                                             | Status      | Notes                                                         |
| ------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| Bridge daemon, socket transport                                                                         | Implemented | `src/main/bridge/server.ts`                                   |
| DB schema (agents/messages/tasks/kv) + v1→v2 migration                                                  | Implemented | `src/main/bridge/db.ts` — v2 adds `response_text`             |
| JSON-RPC codec + error codes                                                                            | Implemented | `src/main/bridge/protocol.ts`                                 |
| Messaging (send-to/notify, timeout, auto-dismiss)                                                       | Implemented | `src/main/bridge/messaging.ts`                                |
| Task FSM + ownership                                                                                    | Implemented | `src/main/bridge/tasks.ts`                                    |
| KV with key/value constraints                                                                           | Implemented | `src/main/bridge/kv.ts`                                       |
| Agent registry + alias resolution                                                                       | Implemented | `src/main/bridge/registry.ts`                                 |
| CLI subcommands (send-to, notify, task, kv, agent, help, version)                                       | Implemented | `src/main/bridge/cli/index.ts`                                |
| `@` alias prefix enforced by CLI; stripped before send                                                  | Implemented | `cli/index.ts:339-343`                                        |
| CLI `parseFlags` — `--status`, `--owned-by`, `--prefix`, `--timeout`                                    | Implemented | `cli/index.ts`                                                |
| Sidecar `env` extension merged into PTY spawn                                                           | Implemented | `src/main/sidecar/server.ts:175`                              |
| `MULTITERM_PANE_ID` injected via SessionCreateParams.env                                                | Implemented | `src/main/ptyManager.ts`                                      |
| Preload IPC: `bridgeOnPending`, `bridgeAccept`, `bridgeDecline`, `bridgeOnDismiss`, `bridgeListPending` | Implemented | `src/preload/index.ts`                                        |
| Renderer: chip on FloatingCard header, modal                                                            | Implemented | `FloatingCard.tsx`, `MessageAcceptModal.tsx`                  |
| Chip/modal CSS                                                                                          | Implemented | `global.css` L3468+                                           |
| Settings toggle "Enable Multiterm Bridge"                                                               | Implemented | `SettingsPanel.tsx:151-159`                                   |
| Main: boot bridge after sidecar, shutdown on `before-quit`                                              | Implemented | `src/main/index.ts`                                           |
| `deregisterAgent` wired to `pty:kill`                                                                   | MISSING     | function exists but is never invoked from `ptyManager.ts:235` |
| `response_text` V2 migration + storage                                                                  | Implemented | `db.ts:62-64`, `messaging.ts:175-177`                         |

---

## Coherence (Design)

| Decision                                             | Followed?                  | Notes                                                        |
| ---------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| Daemon location: module inside Electron main         | Yes                        | `index.ts` boots it post-sidecar                             |
| Storage: `better-sqlite3`                            | Yes                        |                                                              |
| Stable socket path `~/.multiterm-studio/bridge.sock` | Yes                        | via `makeEndpointPath("bridge")`                             |
| CLI as CJS bundle at `resources/multiterm-cli.cjs`   | Yes (named `cli-entry.js`) | `cliInstaller.ts` points to `cli-entry.js` — harmless rename |
| Identity via `MULTITERM_PANE_ID` in sidecar `env`    | Yes                        |                                                              |
| Default ON, Settings toggle                          | Yes                        | default true in `settingsManager.ts`                         |
| Chip + modal (no inbox sidebar)                      | Yes                        |                                                              |
| `schema_version` + up-only migrations                | Yes                        | V1 and V2 applied                                            |

---

## Issues Found

### CRITICAL (must fix before archive)

1. **Typecheck regression in `src/renderer/src/App.tsx:196`** — `bridgeListPending` is not declared in `src/renderer/src/env.d.ts` (the renderer's active `Window.electronAPI` declaration). The preload's `index.d.ts` has it, but `tsconfig.web.json` includes `env.d.ts` which overrides the preload type. `npm run typecheck` fails.
   - Spec ref: not a spec scenario; blocks Phase 8.1 gate.
   - Fix: add the `bridgeListPending` method to `src/renderer/src/env.d.ts` matching the preload signature. Trivial one-place edit.

### WARNING (should fix, does not break behavior)

1. **`deregisterAgent` not wired to `pty:kill`** — `src/main/ptyManager.ts:235` does not call `deregisterAgent(bridgeDb, id)` when a pane is killed. The function exists and is unit-tested, but the integration is missing.
   - Spec ref: `pane-agent-registry` Requirement "Deregistration" → Scenario "Kill releases alias".
   - Recommended action: code fix — call `deregisterAgent` from `pty:kill` handler when `bridgeDb` is available.

2. **"Orphaned" status never persisted** — `pane-messaging` Requirement "Persistence of message log" → Scenario "Restart mid-send" specifies that after restart the message "transitions to `orphaned`". The implementation keeps status `pending` (visible via `bridgeListPending`) and on user action transitions directly to `accepted`/`declined`. Observable behavior (chip reappears, accept/decline works) IS honored.
   - Spec ref: `pane-messaging` scenario "Restart mid-send".
   - Recommended action: spec amendment — either drop the `orphaned` status requirement or document that "orphaned" is a semantic label for pending messages whose sender has exited (which isn't tracked today).

3. **`bridge.task.fail` missing from `METHODS` constant** — `src/main/bridge/protocol.ts` METHODS table doesn't include `TaskFail`, though `server.ts:213` handles `'bridge.task.fail'` as a string literal. Spec `pane-bridge` method table includes it.
   - Spec ref: `pane-bridge` Requirement "Method namespace" — method table row `bridge.task.fail`.
   - Recommended action: code fix — add `TaskFail: 'bridge.task.fail'` to METHODS; optional reference it in server switch.

4. **`bridgeListPending` IPC not covered by any spec** — introduced during smoke to rehydrate chip state on renderer reload. Ship-worthy, tested behaviorally (App.tsx subscription, dedup in bridgeStore), but not formally specified.
   - Spec ref: none.
   - Recommended action: spec amendment — add a scenario under `pane-messaging` Requirement "Accept/decline UI" or a new "Rehydration" requirement documenting that the renderer can query pending messages on mount.

5. **Idempotent dedup in `bridgeStore.bridgePendingReceived`** — protects against the live-event + rehydration race (see WARNING 4). Tested (`tests/renderer/bridgeStore.test.ts`), not specified.
   - Spec ref: none (implementation detail of WARNING 4).
   - Recommended action: call out in the same spec amendment as the `bridgeListPending` IPC, or leave as implementation detail.

6. **"Always-update-DB on accept/decline" not specified** — `acceptMessage` / `declineMessage` now update the DB even when the in-memory `pendingMap` entry is absent (smoke fix for orphan messages). Covered by `tests/main/bridge/messaging.test.ts` orphan-accept / orphan-decline cases.
   - Spec ref: `pane-messaging` — no scenario for "accept of message not in pendingMap".
   - Recommended action: spec amendment — add scenarios under "Synchronous send-to" covering orphan accept/decline (caller already exited).

7. **Lint formatting warnings in new test files** — `tests/renderer/MessageAcceptModal.test.tsx` and `tests/renderer/bridgeStore.test.ts` have prettier warnings (no errors). Phase 8.2 was marked "clean in touched files"; these are technically not clean.
   - Recommended action: `npm run lint --fix` in those files.

### SUGGESTION (nice to have)

1. Unify the CLI bundle naming — `design.md` says `resources/multiterm-cli.cjs`, actual build produces `out/main/cli-entry.js`. Works because `cliInstaller.ts` uses the latter name, but design doc is stale.
2. Add a top-level `multiterm --help` exit-code 0 variant (currently root with no args returns 2 / USAGE). `help` subcommand returns 0 already.
3. Consider adding a `task fail` CLI subcommand for parity with the JSON-RPC method (not spec-required today).

---

## Verdict

**BLOCKED** — one CRITICAL typecheck regression (`App.tsx` / `env.d.ts` mismatch) blocks Phase 8.1 gate. Fix is a single-line declaration add. Once fixed, this change is ready for archive.

All tests pass, all 41 tasks complete, all 7 specs materially implemented. Warnings are spec-amendment or wiring refinements that do not affect end-user behavior except for WARNING 1 (alias not auto-released on pane kill — user can re-claim via explicit `alias @x` on a new pane so not blocking).

### Recommendation

1. Fix CRITICAL #1 (add `bridgeListPending` to `env.d.ts`).
2. Amend specs to cover WARNING 2, 4, 5, 6 (the smoke-era fixes) before archive — this is a good moment to capture them.
3. Consider WARNING 1 as either code fix (preferred, minimal risk) or explicit non-goal to document.
4. Then proceed to `sdd-archive`.
