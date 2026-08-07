/** @vitest-environment node */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { launchTargetFromArgv, isWorkspaceFile } from '../../src/main/launchTarget'

let root: string
let projectDir: string
let wsFile: string
let plainFile: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mts-launch-'))
  projectDir = join(root, 'my project')
  mkdirSync(projectDir)
  wsFile = join(root, 'team.multiterm-workspace')
  writeFileSync(wsFile, '{}')
  plainFile = join(root, 'notes.txt')
  writeFileSync(plainFile, 'hi')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('launchTargetFromArgv', () => {
  it('picks up a directory passed by the CLI', () => {
    expect(launchTargetFromArgv(['/path/to/app', projectDir])).toBe(projectDir)
  })

  it('picks up a workspace file', () => {
    expect(launchTargetFromArgv(['/path/to/app', wsFile])).toBe(wsFile)
  })

  it('resolves a relative path against the given working directory', () => {
    expect(launchTargetFromArgv(['/path/to/app', 'my project'], root)).toBe(projectDir)
  })

  it('ignores the executable itself', () => {
    expect(launchTargetFromArgv([projectDir])).toBeNull()
  })

  it('ignores Electron switches', () => {
    expect(launchTargetFromArgv(['/app', '--inspect', '--no-sandbox'])).toBeNull()
  })

  it('skips switches and still finds the path after them', () => {
    expect(launchTargetFromArgv(['/app', '--enable-logging', projectDir])).toBe(projectDir)
  })

  it('ignores paths that do not exist', () => {
    expect(launchTargetFromArgv(['/app', join(root, 'nope')])).toBeNull()
  })

  it('ignores files that are not workspaces', () => {
    expect(launchTargetFromArgv(['/app', plainFile])).toBeNull()
  })

  it('returns null when there is nothing to open', () => {
    expect(launchTargetFromArgv(['/app'])).toBeNull()
  })
})

describe('isWorkspaceFile', () => {
  it('accepts both workspace extensions', () => {
    expect(isWorkspaceFile('/a/b.multiterm-workspace')).toBe(true)
    expect(isWorkspaceFile('/a/b.code-workspace')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isWorkspaceFile('/a/b.txt')).toBe(false)
    expect(isWorkspaceFile('/a/workspace')).toBe(false)
  })
})
