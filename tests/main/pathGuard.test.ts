/** @vitest-environment node */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { isPathInsideRoots } from '../../src/main/pathGuard'

/**
 * This guard is what stands between `local-resource://` and every file on the
 * machine, so the traversal and symlink cases are the point of the suite.
 */

let root: string
let project: string
let outside: string
let secret: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mts-guard-'))
  project = join(root, 'project')
  mkdirSync(join(project, 'docs'), { recursive: true })
  writeFileSync(join(project, 'docs', 'diagram.png'), 'png')

  outside = join(root, 'outside')
  mkdirSync(outside, { recursive: true })
  secret = join(outside, 'secrets.txt')
  writeFileSync(secret, 'token')

  // A symlink inside the project pointing out of it.
  symlinkSync(secret, join(project, 'escape-hatch'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('isPathInsideRoots — allows', () => {
  it('a file directly inside a root', () => {
    expect(isPathInsideRoots(join(project, 'docs', 'diagram.png'), [project])).toBe(true)
  })

  it('the root itself', () => {
    expect(isPathInsideRoots(project, [project])).toBe(true)
  })

  it('a file under any one of several roots', () => {
    expect(isPathInsideRoots(join(outside, 'secrets.txt'), [project, outside])).toBe(true)
  })

  it('a path that does not exist yet', () => {
    // A file about to be created, or one git still names after it was deleted.
    // On macOS the root resolves under /private, so an unresolved candidate
    // would never match it.
    expect(isPathInsideRoots(join(project, 'docs', 'not-written-yet.png'), [project])).toBe(true)
  })
})

describe('isPathInsideRoots — denies', () => {
  it('a path outside every root', () => {
    expect(isPathInsideRoots(secret, [project])).toBe(false)
  })

  it('a traversal that climbs out of the root', () => {
    expect(isPathInsideRoots(join(project, '..', 'outside', 'secrets.txt'), [project])).toBe(false)
  })

  it('a symlink inside the root that points outside it', () => {
    expect(isPathInsideRoots(join(project, 'escape-hatch'), [project])).toBe(false)
  })

  it('a path that does not exist yet behind a symlink that escapes', () => {
    // The missing leaf must not stop the guard from resolving the link above it.
    const link = join(project, 'escape-dir')
    symlinkSync(outside, link)
    expect(isPathInsideRoots(join(link, 'not-written-yet.txt'), [project])).toBe(false)
  })

  it('a sibling directory sharing the root name as a prefix', () => {
    // "…/project-secrets" must not count as living inside "…/project".
    const sibling = join(root, 'project-secrets')
    mkdirSync(sibling, { recursive: true })
    expect(isPathInsideRoots(join(sibling, 'x.txt'), [project])).toBe(false)
  })

  it('anything at all when no roots are open', () => {
    expect(isPathInsideRoots(join(project, 'docs', 'diagram.png'), [])).toBe(false)
    expect(isPathInsideRoots(join(homedir(), '.ssh', 'id_rsa'), [])).toBe(false)
  })

  it('a sensitive path in the home directory', () => {
    expect(isPathInsideRoots(join(homedir(), '.ssh', 'id_rsa'), [project])).toBe(false)
  })
})
