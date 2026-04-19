---
phase: 2
slug: multi-panel-layout
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **Framework**          | Vitest 3.x + @testing-library/react 16.x                                                                  |
| **Config file**        | `vitest.config.ts` (exists)                                                                               |
| **Quick run command**  | `npm test -- --reporter=verbose tests/renderer/MosaicLayout.test.tsx tests/renderer/PanelHeader.test.tsx` |
| **Full suite command** | `npm test`                                                                                                |
| **Estimated runtime**  | ~10 seconds                                                                                               |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/renderer/MosaicLayout.test.tsx tests/renderer/PanelHeader.test.tsx`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                                             | File Exists | Status     |
| -------- | ---- | ---- | ----------- | --------- | ----------------------------------------------------------------------------- | ----------- | ---------- |
| 02-01-01 | 01   | 1    | LAYOUT-01   | unit      | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "renders initial panel"` | ❌ W0       | ⬜ pending |
| 02-01-02 | 01   | 1    | LAYOUT-03   | unit      | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "onChange updates tree"` | ❌ W0       | ⬜ pending |
| 02-01-03 | 01   | 1    | LAYOUT-05   | unit      | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "add panel"`             | ❌ W0       | ⬜ pending |
| 02-01-04 | 01   | 1    | LAYOUT-08   | unit      | `npm test -- tests/renderer/MosaicLayout.test.tsx -t "ptyKill on close"`      | ❌ W0       | ⬜ pending |
| 02-02-01 | 02   | 1    | LAYOUT-02   | unit      | `npm test -- tests/renderer/PanelHeader.test.tsx -t "split button"`           | ❌ W0       | ⬜ pending |
| 02-02-02 | 02   | 1    | LAYOUT-04   | unit      | `npm test -- tests/renderer/PanelHeader.test.tsx -t "close button"`           | ❌ W0       | ⬜ pending |
| 02-02-03 | 02   | 1    | LAYOUT-06   | unit      | `npm test -- tests/renderer/PanelHeader.test.tsx -t "title edit"`             | ❌ W0       | ⬜ pending |
| 02-02-04 | 02   | 1    | LAYOUT-07   | unit      | `npm test -- tests/renderer/PanelHeader.test.tsx -t "color picker"`           | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `tests/renderer/MosaicLayout.test.tsx` — stubs for LAYOUT-01, LAYOUT-03, LAYOUT-05, LAYOUT-08
- [ ] `tests/renderer/PanelHeader.test.tsx` — stubs for LAYOUT-02, LAYOUT-04, LAYOUT-06, LAYOUT-07
- [ ] `tests/store/panelStore.test.ts` — stubs for zustand store actions (addPanel, removePanel, setTitle, setColor)
- No new framework install needed — vitest + @testing-library/react already installed

---

## Manual-Only Verifications

| Behavior                                            | Requirement | Why Manual                                       | Test Instructions                                                |
| --------------------------------------------------- | ----------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| Drag divider resizes panels and terminal re-renders | LAYOUT-03   | Resize event + xterm.js reflow requires real DOM | 1. Split a panel 2. Drag divider 3. Verify terminal text reflows |
| PTY process killed on close (no zombies)            | LAYOUT-08   | Process lifecycle requires real PTY              | 1. Open panel 2. Run `echo $$` 3. Close panel 4. Verify PID gone |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
