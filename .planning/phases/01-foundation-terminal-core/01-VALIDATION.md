---
phase: 1
slug: foundation-terminal-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                        |
| ---------------------- | -------------------------------------------- |
| **Framework**          | Vitest (bundled with electron-vite scaffold) |
| **Config file**        | `vitest.config.ts` — Wave 0 creates          |
| **Quick run command**  | `npx vitest run --reporter=verbose`          |
| **Full suite command** | `npx vitest run`                             |
| **Estimated runtime**  | ~5 seconds                                   |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                 | File Exists | Status     |
| -------- | ---- | ---- | ----------- | --------- | ------------------------------------------------- | ----------- | ---------- |
| 01-01-01 | 01   | 1    | INFRA-01    | unit      | `npx vitest run tests/main/window.test.ts`        | ❌ W0       | ⬜ pending |
| 01-01-02 | 01   | 1    | INFRA-02    | unit      | `npx vitest run tests/main/ptyManager.test.ts`    | ❌ W0       | ⬜ pending |
| 01-01-03 | 01   | 1    | INFRA-04    | smoke     | `npm run dev` (manual)                            | manual      | ⬜ pending |
| 01-01-04 | 01   | 1    | INFRA-05    | unit      | `npx vitest run tests/renderer/theme.test.ts`     | ❌ W0       | ⬜ pending |
| 01-02-01 | 02   | 1    | INFRA-03    | static    | `grep -r "node-pty" src/renderer` returns empty   | manual      | ⬜ pending |
| 01-02-02 | 02   | 1    | TERM-01     | unit      | `npx vitest run tests/main/ptyManager.test.ts`    | ❌ W0       | ⬜ pending |
| 01-02-03 | 02   | 1    | TERM-02     | unit      | `npx vitest run tests/main/ptyManager.test.ts`    | ❌ W0       | ⬜ pending |
| 01-03-01 | 03   | 1    | TERM-03     | unit      | `npx vitest run tests/renderer/Terminal.test.tsx` | ❌ W0       | ⬜ pending |
| 01-03-02 | 03   | 1    | TERM-04     | unit      | `npx vitest run tests/renderer/Terminal.test.tsx` | ❌ W0       | ⬜ pending |
| 01-03-03 | 03   | 1    | TERM-05     | unit      | `npx vitest run tests/renderer/Terminal.test.tsx` | ❌ W0       | ⬜ pending |
| 01-03-04 | 03   | 1    | TERM-06     | manual    | Visual: `printf '\e[38;5;196mRed\n'`              | manual      | ⬜ pending |
| 01-03-05 | 03   | 1    | TERM-07     | manual    | Visual: `echo "Hello 👋"`                         | manual      | ⬜ pending |
| 01-03-06 | 03   | 1    | TERM-08     | manual    | Interactive: Ctrl+C, arrow keys                   | manual      | ⬜ pending |
| 01-03-07 | 03   | 1    | TERM-09     | manual    | Interactive: copy/paste                           | manual      | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `tests/main/window.test.ts` — stubs for INFRA-01: BrowserWindow webPreferences
- [ ] `tests/main/ptyManager.test.ts` — stubs for INFRA-02, INFRA-03, TERM-01, TERM-02: PTY lifecycle and IPC
- [ ] `tests/renderer/Terminal.test.tsx` — stubs for TERM-03, TERM-04, TERM-05: xterm.js setup
- [ ] `tests/renderer/theme.test.ts` — stubs for INFRA-05: CSS custom property values
- [ ] `vitest.config.ts` — test config with jsdom environment for renderer tests
- [ ] Framework install: `npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom`

---

## Manual-Only Verifications

| Behavior                                   | Requirement | Why Manual                                    | Test Instructions                              |
| ------------------------------------------ | ----------- | --------------------------------------------- | ---------------------------------------------- |
| ANSI 256-color / 24-bit color rendering    | TERM-06     | Visual verification needed — canvas rendering | Run `printf '\e[38;5;196mRed\n'` in terminal   |
| Unicode/emoji rendering                    | TERM-07     | Visual font/glyph verification                | Run `echo "Hello 👋 ñ ü"` in terminal          |
| Keyboard passthrough (Ctrl+C, arrows, tab) | TERM-08     | Interactive behavior                          | Type Ctrl+C during running process, use arrows |
| Copy/paste clipboard                       | TERM-09     | OS-level clipboard interaction                | Select text, Cmd+C, then Cmd+V                 |
| App starts without errors                  | INFRA-04    | Full Electron lifecycle smoke test            | Run `npm run dev`, verify window appears       |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
