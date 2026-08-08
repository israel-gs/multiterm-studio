/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * These handlers move and delete files in the user's project, so they are
 * exercised against a real directory rather than mocked fs calls.
 */

const handlers: Record<string, (...args: unknown[]) => unknown> = {}
const trashItem = vi.fn().mockResolvedValue(undefined)

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }
  },
  shell: { trashItem: (p: string) => trashItem(p) }
}))

let root: string
const event = {}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'mts-files-'))
  vi.clearAllMocks()
  vi.resetModules()
  for (const k of Object.keys(handlers)) delete handlers[k]
  const { registerFileHandlers } = await import('../../src/main/fileManager')
  registerFileHandlers()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('file:read and file:write', () => {
  it('round-trips content', async () => {
    const p = join(root, 'note.md')
    await handlers['file:write'](event, p, '# hello')

    expect(await handlers['file:read'](event, p)).toBe('# hello')
  })

  it('overwrites an existing file', async () => {
    const p = join(root, 'note.md')
    writeFileSync(p, 'old')
    await handlers['file:write'](event, p, 'new')

    expect(readFileSync(p, 'utf-8')).toBe('new')
  })

  it('rejects when the file does not exist', async () => {
    await expect(handlers['file:read'](event, join(root, 'ghost.txt'))).rejects.toThrow()
  })
})

describe('file:create and folder:create', () => {
  it('creates an empty file by default', async () => {
    const p = join(root, 'new.txt')
    await handlers['file:create'](event, p)

    expect(readFileSync(p, 'utf-8')).toBe('')
  })

  it('creates nested folders', async () => {
    const p = join(root, 'a', 'b', 'c')
    await handlers['folder:create'](event, p)

    expect(existsSync(p)).toBe(true)
  })

  it('creating an existing folder is not an error', async () => {
    const p = join(root, 'a')
    await handlers['folder:create'](event, p)

    await expect(handlers['folder:create'](event, p)).resolves.toBeUndefined()
  })
})

describe('file:rename', () => {
  it('renames within the same directory and returns the new path', async () => {
    const p = join(root, 'before.txt')
    writeFileSync(p, 'x')

    const next = await handlers['file:rename'](event, p, 'after.txt')

    expect(next).toBe(join(root, 'after.txt'))
    expect(existsSync(p)).toBe(false)
    expect(readFileSync(next as string, 'utf-8')).toBe('x')
  })
})

describe('file:move', () => {
  it('moves a file into another folder, keeping its name', async () => {
    const src = join(root, 'doc.txt')
    const target = join(root, 'sub')
    writeFileSync(src, 'body')
    mkdirSync(target)

    const next = await handlers['file:move'](event, src, target)

    expect(next).toBe(join(target, 'doc.txt'))
    expect(readFileSync(next as string, 'utf-8')).toBe('body')
    expect(existsSync(src)).toBe(false)
  })

  it('rejects when the target folder does not exist', async () => {
    const src = join(root, 'doc.txt')
    writeFileSync(src, 'body')

    await expect(handlers['file:move'](event, src, join(root, 'ghost'))).rejects.toThrow()
    // The source must survive a failed move.
    expect(existsSync(src)).toBe(true)
  })
})

describe('file:trash', () => {
  it('goes through the OS trash rather than unlinking', async () => {
    // Deleting outright would give the user no way back.
    const p = join(root, 'bye.txt')
    writeFileSync(p, 'x')

    await handlers['file:trash'](event, p)

    expect(trashItem).toHaveBeenCalledWith(p)
  })
})
