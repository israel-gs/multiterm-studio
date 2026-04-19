# Design: Remove tmux, replace with sidecar PTY backend

## Technical Approach

Introduce a `sidecar` module inside `src/main/sidecar/` that runs as a forked Node child process. The sidecar owns every `node-pty` instance and a `RingBuffer` per session. `ptyManager.ts` keeps its current `registerPtyHandlers(win)` entry point but internally swaps tmux calls for a `SidecarClient`. Renderer-facing IPC channels stay stable except for three deletions (`pty:list-panes`, `pty:select-pane`, `pty:send-keys`) and one addition (`pty:cwd-changed`, renderer→main). Mouse mode moves to xterm.js native config. OSC 7 parsing lives in the renderer via `terminal.parser.registerOscHandler(7, …)`.

## Architecture Decisions

| Decision             | Choice                                             | Alternatives                                                                                      | Rationale                                                                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidecar transport    | `child_process.fork()` + Unix socket / Named Pipe  | UNIX domain socket to a standalone binary; WebSocket on localhost                                 | `fork()` uses the same Node runtime as main, shares electron-vite build pipeline, and avoids port allocation.                                                                                                                                                                                                    |
| Control protocol     | JSON-RPC 2.0, newline-delimited                    | Custom binary; gRPC; Protocol Buffers                                                             | Human-debuggable, trivially testable, matches the reference project and MCP conventions.                                                                                                                                                                                                                         |
| Session data         | Dedicated socket per session                       | Multiplexed frames on control socket                                                              | Avoids framing bugs and backpressure coupling. One failing session cannot stall others.                                                                                                                                                                                                                          |
| Ring buffer location | Inside sidecar process                             | In main process                                                                                   | Sidecar owns the PTY stream; zero copies when buffering, and a main crash does not lose scrollback.                                                                                                                                                                                                              |
| OSC 7 parser         | Renderer (xterm.js OSC handler)                    | Main process stream parser                                                                        | xterm.js already parses OSC frames; duplicating in main means re-implementing the state machine. Renderer emits `pty:cwd-changed` back to main.                                                                                                                                                                  |
| Attention detection  | Stays in `ptyManager` (main)                       | Move to sidecar                                                                                   | Keeps the sidecar focused on PTY+buffer. Attention needs BrowserWindow access.                                                                                                                                                                                                                                   |
| Mouse mode           | Removed from UI; rely on xterm.js default behavior | Toggle writing `\e[?1000h/l` manually (initial Phase 3 attempt); wire `options.mouseTrackingMode` | The initial manual-escape approach broke plain-shell usage (mouse events sent to the PTY appeared as garbage at the prompt). xterm.js handles scroll/select correctly by default; any app that wants mouse reporting emits `\e[?1000h` itself. Removing the toggle eliminates dead UX without losing capability. |

## Data Flow

Session create and live stream:

    Renderer ── invoke pty:create ──▶ ptyManager (main)
                                         │
                                         │ rpc session.create
                                         ▼
                                    SidecarClient ─── socket ───▶ Sidecar
                                                                    │
                                                                    ▼
                                                                  node-pty + RingBuffer
                                         ◀── sessionId, dataEndpoint ──
                                         │
                                         │ connect data socket
                                         ▼
                                    Sidecar streams bytes ─▶ ptyManager ─▶ win.webContents.send("pty:data:id")

Reconnect after renderer restart:

    Renderer (new) ── ptyCreate(sameId) ──▶ ptyManager
                                                │
                                                │ rpc session.replay(id)
                                                ▼
                                            Sidecar flushes RingBuffer to data socket
                                                │
                                                ▼
                                            Renderer receives "pty:scrollback:id", then live data

## File Changes

| File                                              | Action | Description                                                                                  |
| ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `src/main/sidecar/entry.ts`                       | Create | Child-process entry; boots server and PTY registry.                                          |
| `src/main/sidecar/server.ts`                      | Create | JSON-RPC control server + per-session data socket orchestration.                             |
| `src/main/sidecar/client.ts`                      | Create | `SidecarClient` used by `ptyManager`; request/response correlation.                          |
| `src/main/sidecar/protocol.ts`                    | Create | Endpoint path helpers, `makeEndpointPath`, JSON-RPC codecs, constants.                       |
| `src/main/sidecar/ring-buffer.ts`                 | Create | Bounded byte ring buffer with `write`, `replay`, `resize`.                                   |
| `src/main/sidecar/shell-init.ts`                  | Create | `osc7ShellHook(shell)` + ZDOTDIR integration builder.                                        |
| `src/main/ptyManager.ts`                          | Modify | Drop tmux helpers and tmux IPC handlers; add sidecar client use; keep `registerPtyHandlers`. |
| `src/main/index.ts`                               | Modify | Boot sidecar before window; cleanup on `before-quit`; drop tmux imports.                     |
| `src/preload/index.ts` + `.d.ts`                  | Modify | Remove `ptyListPanes`, `ptySelectPane`, `ptySendKeys`; add `ptyCwdChanged`.                  |
| `src/renderer/src/components/TmuxPaneSidebar.tsx` | Delete | Feature removed with Team Agents navigation.                                                 |
| `src/renderer/src/components/Terminal.tsx`        | Modify | Register OSC 7 handler; set xterm mouse options from settings.                               |
| `src/renderer/src/components/SettingsPanel.tsx`   | Modify | Relabel "Tmux mouse mode" → "Mouse mode"; wire to xterm.                                     |
| `electron.vite.config.ts`                         | Modify | Add sidecar build entry.                                                                     |
| `electron-builder.yml`                            | Modify | Drop `vendor/tmux`, `lib`, `terminfo`, `tmux.conf` from `extraResources`.                    |
| `resources/tmux*`, `lib/`, `terminfo/`            | Delete | Unshipped assets.                                                                            |
| `README.md`, `.planning/research/FEATURES.md`     | Modify | Update stack description.                                                                    |

## Interfaces / Contracts

```ts
// src/main/sidecar/protocol.ts
export interface SessionCreateParams {
  sessionId: string
  shell: string
  cwd: string
  cols: number
  rows: number
  scrollbackBytes?: number // defaults to 8 MB
}
export interface SessionCreateResult {
  sessionId: string
  dataEndpoint: string
}

export type RpcMethod =
  | 'session.create'
  | 'session.write' // { sessionId, data }
  | 'session.resize' // { sessionId, cols, rows }
  | 'session.kill' // { sessionId }
  | 'session.replay' // { sessionId } → streams to data socket
```

Endpoint helper:

```ts
export function makeEndpointPath(name: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\multiterm-${name}`
    : join(homedir(), '.multiterm-studio', `${name}.sock`)
}
```

## Testing Strategy

| Layer       | What                                                                                                         | Approach                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Unit        | `ring-buffer` (write, overflow, replay, resize); `osc7ShellHook` per shell; `makeEndpointPath` per platform. | Pure `vitest`; no Electron.                                               |
| Integration | Sidecar startup, JSON-RPC round trip, session lifecycle, reconnect + replay.                                 | `vitest` spawning the compiled sidecar entry against a real Unix socket.  |
| Integration | Renderer OSC 7 handler emits `pty:cwd-changed`.                                                              | `@testing-library/react` + jsdom; feed PTY output through a mocked xterm. |
| E2E         | Not available in project stack.                                                                              | Skip; add Playwright later if needed.                                     |

## Migration / Rollout

No data migration required. Existing session metadata under `~/.multiterm-studio/sessions/` is tmux-specific and obsolete; add a one-shot cleanup on first run that removes files whose `createdAt` predates the upgrade. Feature flags are not used — the change is atomic on the branch and revert-friendly per the proposal rollback plan.

## Open Questions

None. Closed:

- **Platform scope for this change**: macOS and Linux only. The `makeEndpointPath` helper keeps the Windows branch for forward compatibility, but the Named Pipe transport is NOT validated in this change — Windows support lands in a follow-up change.
- **Sidecar survival across main crash**: no. If main dies, the sidecar SHALL shut down. No orphan processes, no recovery of dead-main sessions. Simpler mental model; consistent with the "quit = everything dies" invariant from the proposal.
