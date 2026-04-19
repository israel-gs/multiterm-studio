---
phase: 4
slug: attention-detection-persistence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                     |
| ---------------------- | ------------------------- |
| **Framework**          | Vitest 3.x                |
| **Config file**        | `vitest.config.ts` (root) |
| **Quick run command**  | `pnpm test`               |
| **Full suite command** | `pnpm test`               |
| **Estimated runtime**  | ~5 seconds                |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                       | File Exists    | Status     |
| -------- | ---- | ---- | ----------- | --------- | ------------------------------------------------------- | -------------- | ---------- |
| 04-01-01 | 01   | 1    | ATTN-01     | unit      | `pnpm test -- tests/main/ptyManager.test.ts`            | ❌ W0 — extend | ⬜ pending |
| 04-01-02 | 01   | 1    | ATTN-01     | unit      | `pnpm test -- tests/main/ptyManager.test.ts`            | ❌ W0 — extend | ⬜ pending |
| 04-01-03 | 01   | 1    | ATTN-02     | unit      | `pnpm test -- tests/store/panelStore.test.ts`           | ❌ W0 — extend | ⬜ pending |
| 04-01-04 | 01   | 1    | ATTN-02     | unit      | `pnpm test -- tests/renderer/PanelHeader.test.tsx`      | ❌ W0 — extend | ⬜ pending |
| 04-01-05 | 01   | 1    | ATTN-03     | unit      | `pnpm test -- tests/main/attentionService.test.ts`      | ❌ W0 — new    | ⬜ pending |
| 04-02-01 | 02   | 1    | PERS-01     | unit      | `pnpm test -- tests/main/layoutManager.test.ts`         | ❌ W0 — new    | ⬜ pending |
| 04-02-02 | 02   | 1    | PERS-02     | unit      | `pnpm test -- tests/renderer/layoutPersistence.test.ts` | ❌ W0 — new    | ⬜ pending |
| 04-02-03 | 02   | 1    | PERS-03     | unit      | `pnpm test -- tests/renderer/MosaicLayout.test.tsx`     | ❌ W0 — extend | ⬜ pending |
| 04-02-04 | 02   | 1    | PERS-03     | unit      | `pnpm test -- tests/store/panelStore.test.ts`           | ❌ W0 — extend | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `tests/main/attentionService.test.ts` — stubs for ATTN-03 (Notification mock + isFocused mock)
- [ ] `tests/main/layoutManager.test.ts` — stubs for PERS-01 (fs/promises mock matching folderManager.test.ts pattern)
- [ ] `tests/renderer/layoutPersistence.test.ts` — stubs for PERS-02 (fake timers for debounce testing)

Existing tests extend in-place (no new files needed):

- `tests/main/ptyManager.test.ts` — extend for ATTN-01 (regex matching, cooldown)
- `tests/store/panelStore.test.ts` — extend for ATTN-02, PERS-03 (attention field, restore)
- `tests/renderer/PanelHeader.test.tsx` — extend for ATTN-02 (badge rendering)
- `tests/renderer/MosaicLayout.test.tsx` — extend for PERS-03 (tree restore)

---

## Manual-Only Verifications

| Behavior                           | Requirement | Why Manual                                 | Test Instructions                                                    |
| ---------------------------------- | ----------- | ------------------------------------------ | -------------------------------------------------------------------- |
| Pulsing badge animation visible    | ATTN-02     | CSS animation visual check                 | Run `npm init` in unfocused panel, verify pulsing dot on color dot   |
| Native OS notification appears     | ATTN-03     | Electron Notification requires running app | Background the app, run interactive CLI command, verify notification |
| Notification click focuses panel   | ATTN-03     | Requires native click event                | Click the notification, verify app focuses + correct panel selected  |
| Layout persists across app restart | PERS-01/03  | Requires full app lifecycle                | Arrange panels, quit app, reopen same folder, verify layout restored |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
