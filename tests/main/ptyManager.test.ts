import { describe, test } from 'vitest'

/**
 * INFRA-02: All IPC channels registered via contextBridge
 * TERM-01: PTY spawns real shell session
 * TERM-02: Shell starts with cwd set to project folder
 *
 * These are stub tests (test.todo) that will be implemented in Plan 02
 * when ptyManager.ts is fully implemented with ipcMain handlers.
 */
describe('ptyManager IPC handlers (INFRA-02)', () => {
  test.todo('pty:create handler spawns a PTY session')
  test.todo('pty:write handler writes to PTY')
  test.todo('pty:resize handler resizes PTY')
  test.todo('pty:kill handler kills PTY and removes session')
})

describe('PTY session behavior (TERM-01, TERM-02)', () => {
  test.todo('spawns with process.env.SHELL')
  test.todo('spawns with cwd from IPC argument')
})
