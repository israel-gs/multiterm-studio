/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadWorkspaceFile,
  saveWorkspaceFile,
  saveWorkspaceFileSync
} from '../../src/main/workspaceFileManager'

/**
 * This file is the user's workspace definition. The property that matters most
 * is that loading and saving never quietly drops a folder — an earlier version
 * filtered out unreachable folders on load and then wrote the filtered list
 * back, erasing folders on unmounted volumes for good.
 */

let root: string
let present: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mts-ws-'))
  present = join(root, 'present')
  mkdirSync(present, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const wsPath = (): string => join(root, 'team.multiterm-workspace')

describe('loadWorkspaceFile', () => {
  it('reads a native workspace', async () => {
    writeFileSync(
      wsPath(),
      JSON.stringify({ version: 1, folders: [{ path: present }], layout: null, expandedDirs: {} })
    )

    const ws = await loadWorkspaceFile(wsPath())
    expect(ws?.folders).toEqual([{ path: present }])
  })

  it('keeps folders that are not currently reachable', async () => {
    const missing = join(root, 'on-an-unmounted-volume')
    writeFileSync(
      wsPath(),
      JSON.stringify({
        version: 1,
        folders: [{ path: present }, { path: missing }],
        layout: null,
        expandedDirs: {}
      })
    )

    const ws = await loadWorkspaceFile(wsPath())
    expect(ws?.folders.map((f) => f.path)).toEqual([present, missing])
  })

  it('survives a round trip without losing an unreachable folder', async () => {
    const missing = join(root, 'gone')
    writeFileSync(
      wsPath(),
      JSON.stringify({
        version: 1,
        folders: [{ path: present }, { path: missing }],
        layout: null,
        expandedDirs: {}
      })
    )

    const loaded = await loadWorkspaceFile(wsPath())
    await saveWorkspaceFile(wsPath(), loaded!)
    const reloaded = await loadWorkspaceFile(wsPath())

    expect(reloaded?.folders.map((f) => f.path)).toEqual([present, missing])
  })

  it('returns null for a missing file', async () => {
    expect(await loadWorkspaceFile(join(root, 'nope.multiterm-workspace'))).toBeNull()
  })

  it('returns null for malformed JSON', async () => {
    writeFileSync(wsPath(), '{ not json')
    expect(await loadWorkspaceFile(wsPath())).toBeNull()
  })

  it('rejects an unknown version', async () => {
    writeFileSync(wsPath(), JSON.stringify({ version: 99, folders: [] }))
    expect(await loadWorkspaceFile(wsPath())).toBeNull()
  })
})

describe('loadWorkspaceFile — VS Code workspaces', () => {
  it('converts a .code-workspace', async () => {
    const p = join(root, 'x.code-workspace')
    writeFileSync(p, JSON.stringify({ folders: [{ path: present }] }))

    const ws = await loadWorkspaceFile(p)
    expect(ws?.version).toBe(1)
    expect(ws?.folders).toEqual([{ path: present }])
  })

  it('resolves relative folder paths against the workspace file', async () => {
    const p = join(root, 'x.code-workspace')
    writeFileSync(p, JSON.stringify({ folders: [{ path: 'present' }] }))

    const ws = await loadWorkspaceFile(p)
    expect(ws?.folders[0].path).toBe(present)
  })
})

describe('saveWorkspaceFile', () => {
  const workspace = {
    version: 1 as const,
    folders: [{ path: '/a' }],
    layout: null,
    expandedDirs: { '/a': ['/a/src'] }
  }

  it('writes JSON that loads back identically', async () => {
    await saveWorkspaceFile(wsPath(), workspace)
    expect(await loadWorkspaceFile(wsPath())).toEqual(workspace)
  })

  it('leaves no temporary file behind', async () => {
    await saveWorkspaceFile(wsPath(), workspace)
    const leftovers = readFileSync(wsPath(), 'utf-8')
    expect(leftovers.length).toBeGreaterThan(0)
    expect(existsSync(`${wsPath()}.tmp`)).toBe(false)
  })

  it('does not throw when the target directory cannot be written', async () => {
    // A failed save must never take the window down.
    await expect(
      saveWorkspaceFile('/proc/nonexistent/dir/ws.multiterm-workspace', workspace)
    ).resolves.toBeUndefined()
  })

  it('the sync variant used on quit writes the same shape', () => {
    saveWorkspaceFileSync(wsPath(), workspace)
    expect(JSON.parse(readFileSync(wsPath(), 'utf-8'))).toEqual(workspace)
  })

  it('the sync variant does not throw on an unwritable path', () => {
    expect(() =>
      saveWorkspaceFileSync('/proc/nonexistent/dir/ws.multiterm-workspace', workspace)
    ).not.toThrow()
  })
})
