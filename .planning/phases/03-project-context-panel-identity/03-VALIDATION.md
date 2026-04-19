---
phase: 3
slug: project-context-panel-identity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Framework**          | Vitest 3.x + @testing-library/react 16.x                                                                         |
| **Config file**        | `vitest.config.ts`                                                                                               |
| **Quick run command**  | `npm test -- tests/main/folderManager.test.ts tests/renderer/FileTree.test.tsx tests/store/projectStore.test.ts` |
| **Full suite command** | `npm test`                                                                                                       |
| **Estimated runtime**  | ~5 seconds                                                                                                       |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- tests/main/folderManager.test.ts tests/renderer/FileTree.test.tsx tests/store/projectStore.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                                    | File Exists | Status     |
| -------- | ---- | ---- | ----------- | --------- | -------------------------------------------------------------------- | ----------- | ---------- |
| 03-01-01 | 01   | 1    | PROJ-01     | unit      | `npm test -- tests/main/folderManager.test.ts -t "folder:open"`      | ❌ W0       | ⬜ pending |
| 03-01-02 | 01   | 1    | PROJ-01     | unit      | `npm test -- tests/main/folderManager.test.ts -t "canceled"`         | ❌ W0       | ⬜ pending |
| 03-01-03 | 01   | 1    | PROJ-01     | unit      | `npm test -- tests/main/folderManager.test.ts -t "returns path"`     | ❌ W0       | ⬜ pending |
| 03-01-04 | 01   | 1    | PROJ-02     | unit      | `npm test -- tests/main/folderManager.test.ts -t "folder:readdir"`   | ❌ W0       | ⬜ pending |
| 03-01-05 | 01   | 1    | PROJ-02     | unit      | `npm test -- tests/renderer/FileTree.test.tsx -t "renders entries"`  | ❌ W0       | ⬜ pending |
| 03-01-06 | 01   | 1    | PROJ-03     | unit      | `npm test -- tests/renderer/FileTree.test.tsx -t "expand directory"` | ❌ W0       | ⬜ pending |
| 03-01-07 | 01   | 1    | PROJ-03     | unit      | `npm test -- tests/renderer/FileTree.test.tsx -t "lazy load"`        | ❌ W0       | ⬜ pending |
| 03-01-08 | 01   | 1    | PROJ-03     | unit      | `npm test -- tests/renderer/FileTree.test.tsx -t "cache"`            | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `tests/main/folderManager.test.ts` — stubs for PROJ-01, PROJ-02 (IPC handler tests using capturedHandlers pattern from ptyManager.test.ts)
- [ ] `tests/renderer/FileTree.test.tsx` — stubs for PROJ-02, PROJ-03 (React component with mocked electronAPI)
- [ ] `tests/store/projectStore.test.ts` — stubs for useProjectStore actions

_Existing infrastructure covers framework install — vitest + @testing-library/react already installed._

---

## Manual-Only Verifications

| Behavior                                             | Requirement | Why Manual                                        | Test Instructions                                                |
| ---------------------------------------------------- | ----------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| Native folder picker dialog appears on first launch  | PROJ-01     | OS-native dialog cannot be triggered in unit test | Launch app with no prior folder → verify OS dialog appears       |
| Sidebar displays file tree of opened folder          | PROJ-02     | Visual layout verification                        | Pick a folder → verify left sidebar shows file tree              |
| Terminal panels start in the selected project folder | PROJ-01     | End-to-end PTY cwd check                          | Open folder → add new terminal → run `pwd` → verify path matches |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
