/** @vitest-environment node */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { GitDiffResult, GitStatus, GitStatusResult } from '../../src/shared/git'

/**
 * Exercised against a real repository: the point of these handlers is how git
 * itself reacts, in particular that a branch name which looks like a flag is
 * treated as a name and not parsed as an option.
 */

const handlers: Record<string, (...args: unknown[]) => unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler
    }
  }
}))

let root: string
let repo: string
let plain: string
const event = {}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'mts-git-'))
  repo = join(root, 'repo')
  plain = join(root, 'plain')
  execFileSync('mkdir', ['-p', repo, plain])

  git(['init', '-q', '-b', 'main'], repo)
  git(['config', 'user.email', 'test@example.com'], repo)
  git(['config', 'user.name', 'Test'], repo)
  writeFileSync(join(repo, 'file.txt'), 'hi')
  git(['add', '.'], repo)
  git(['commit', '-qm', 'initial'], repo)

  const { registerGitHandlers } = await import('../../src/main/gitManager')
  registerGitHandlers()
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('git:is-repo', () => {
  it('is true inside a repository', async () => {
    expect(await handlers['git:is-repo'](event, repo)).toBe(true)
  })

  it('is false for a plain directory', async () => {
    expect(await handlers['git:is-repo'](event, plain)).toBe(false)
  })
})

describe('git:branches', () => {
  it('reports the current branch and the list', async () => {
    const result = (await handlers['git:branches'](event, repo)) as {
      current: string
      branches: string[]
      detached: boolean
    }

    expect(result.current).toBe('main')
    expect(result.branches).toContain('main')
    expect(result.detached).toBe(false)
  })
})

describe('git:create-branch and git:checkout', () => {
  it('creates a branch and switches to it', async () => {
    const created = (await handlers['git:create-branch'](event, repo, 'feature/x')) as {
      ok: boolean
    }
    expect(created.ok).toBe(true)

    const state = (await handlers['git:branches'](event, repo)) as { current: string }
    expect(state.current).toBe('feature/x')
  })

  it('switches back to an existing branch', async () => {
    const out = (await handlers['git:checkout'](event, repo, 'main')) as { ok: boolean }
    expect(out.ok).toBe(true)

    const state = (await handlers['git:branches'](event, repo)) as { current: string }
    expect(state.current).toBe('main')
  })

  it('reports a failure instead of throwing', async () => {
    const out = (await handlers['git:checkout'](event, repo, 'no-such-branch')) as {
      ok: boolean
      error?: string
    }
    expect(out.ok).toBe(false)
    expect(out.error).toBeTruthy()
  })
})

describe('option injection', () => {
  // Without --end-of-options git parses these as flags rather than as names.
  const flagLike = '--upload-pack=touch /tmp/mts-pwned'

  it('treats a flag-like branch name as a name when checking out', async () => {
    const out = (await handlers['git:checkout'](event, repo, flagLike)) as {
      ok: boolean
      error?: string
    }

    expect(out.ok).toBe(false)
    // The tell-tale of option parsing is git complaining about an unknown
    // option; we want a "not found" style error instead.
    expect(out.error ?? '').not.toMatch(/unknown option|usage: git/i)
  })

  it('treats a flag-like branch name as a name when deleting', async () => {
    const out = (await handlers['git:delete-branch'](event, repo, flagLike)) as {
      ok: boolean
      error?: string
    }

    expect(out.ok).toBe(false)
    expect(out.error ?? '').not.toMatch(/unknown option|usage: git/i)
  })

  it('treats a flag-like branch name as a name when creating', async () => {
    const out = (await handlers['git:create-branch'](event, repo, flagLike)) as {
      ok: boolean
      error?: string
    }

    expect(out.ok).toBe(false)
    expect(out.error ?? '').not.toMatch(/unknown option|usage: git/i)
  })
})

describe('git:delete-branch', () => {
  it('deletes a merged branch', async () => {
    await handlers['git:create-branch'](event, repo, 'to-delete')
    await handlers['git:checkout'](event, repo, 'main')

    const out = (await handlers['git:delete-branch'](event, repo, 'to-delete')) as { ok: boolean }
    expect(out.ok).toBe(true)

    const state = (await handlers['git:branches'](event, repo)) as { branches: string[] }
    expect(state.branches).not.toContain('to-delete')
  })
})

/**
 * The porcelain v2 grammar is parsed by hand, so the cases that decide whether
 * the parser is correct — a path with a space, a rename's second field — are
 * exercised directly rather than only through whatever git happens to emit.
 */
describe('parseStatusPorcelainV2', () => {
  const nul = (...records: string[]): string => records.map((r) => r + '\0').join('')

  it('reads the branch header', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    const status = parseStatusPorcelainV2(
      nul(
        '# branch.oid abc123',
        '# branch.head main',
        '# branch.upstream origin/main',
        '# branch.ab +2 -3'
      )
    )

    expect(status.branch).toBe('main')
    expect(status.upstream).toBe('origin/main')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(3)
    expect(status.detached).toBe(false)
  })

  it('flags a detached HEAD', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    const status = parseStatusPorcelainV2(nul('# branch.head (detached)'))

    expect(status.detached).toBe(true)
    expect(status.branch).toBe('')
  })

  it('keeps spaces in a path instead of truncating at the first one', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    const status = parseStatusPorcelainV2(
      nul('1 .M N... 100644 100644 100644 aaaa bbbb my file.txt')
    )

    expect(status.files).toEqual([
      { path: 'my file.txt', index: 'unmodified', worktree: 'modified' }
    ])
  })

  it('pairs a rename with the source path in the following field', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    const status = parseStatusPorcelainV2(
      nul(
        '2 R. N... 100644 100644 100644 aaaa bbbb R100 new name.txt',
        'old name.txt',
        '? after.txt'
      )
    )

    expect(status.files).toEqual([
      { path: 'new name.txt', origPath: 'old name.txt', index: 'renamed', worktree: 'unmodified' },
      // The entry after a rename must not be swallowed as its source.
      { path: 'after.txt', index: 'unmodified', worktree: 'untracked' }
    ])
  })

  it('reports both sides of a staged-and-modified file', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    const status = parseStatusPorcelainV2(nul('1 MM N... 100644 100644 100644 aaaa bbbb both.txt'))

    expect(status.files[0]).toMatchObject({ index: 'modified', worktree: 'modified' })
  })

  it('marks an unmerged entry on both sides', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    const status = parseStatusPorcelainV2(
      nul('u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.txt')
    )

    expect(status.files).toEqual([
      { path: 'conflict.txt', index: 'unmerged', worktree: 'unmerged' }
    ])
  })

  it('skips ignored entries', async () => {
    const { parseStatusPorcelainV2 } = await import('../../src/main/gitManager')
    expect(parseStatusPorcelainV2(nul('! node_modules/')).files).toEqual([])
  })
})

describe('git:status and git:diff', () => {
  let dirty: string
  const byPath = (status: GitStatus, path: string): GitStatus['files'][number] | undefined =>
    status.files.find((file) => file.path === path)

  async function status(): Promise<GitStatus> {
    const result = (await handlers['git:status'](event, dirty)) as GitStatusResult
    if (!result.ok) throw new Error(result.error)
    return result.status
  }

  async function diff(path: string, staged = false): Promise<GitDiffResult> {
    return (await handlers['git:diff'](event, dirty, path, staged)) as GitDiffResult
  }

  beforeAll(() => {
    dirty = join(root, 'dirty')
    mkdirSync(dirty)
    git(['init', '-q', '-b', 'main'], dirty)
    git(['config', 'user.email', 'test@example.com'], dirty)
    git(['config', 'user.name', 'Test'], dirty)

    writeFileSync(join(dirty, 'tracked.txt'), 'one\n')
    writeFileSync(join(dirty, 'gone.txt'), 'bye\n')
    writeFileSync(join(dirty, 'old name.txt'), 'renamed body\n')
    writeFileSync(join(dirty, 'blob.bin'), Buffer.from([0x89, 0x00, 0x01, 0x02]))
    git(['add', '.'], dirty)
    git(['commit', '-qm', 'initial'], dirty)

    // One file per state the sidebar has to render.
    writeFileSync(join(dirty, 'tracked.txt'), 'one\ntwo\n')
    unlinkSync(join(dirty, 'gone.txt'))
    writeFileSync(join(dirty, 'staged.txt'), 'staged body\n')
    git(['add', 'staged.txt'], dirty)
    git(['mv', 'old name.txt', 'new name.txt'], dirty)
    writeFileSync(join(dirty, 'untracked.txt'), 'fresh\n')
  })

  it('reports the branch with no upstream configured', async () => {
    const result = await status()

    expect(result.branch).toBe('main')
    expect(result.upstream).toBeUndefined()
    expect(result.ahead).toBe(0)
    expect(result.behind).toBe(0)
  })

  it('separates worktree changes from staged ones', async () => {
    const result = await status()

    expect(byPath(result, 'tracked.txt')).toMatchObject({
      index: 'unmodified',
      worktree: 'modified'
    })
    expect(byPath(result, 'staged.txt')).toMatchObject({
      index: 'added',
      worktree: 'unmodified'
    })
    expect(byPath(result, 'gone.txt')).toMatchObject({ worktree: 'deleted' })
    expect(byPath(result, 'untracked.txt')).toMatchObject({ worktree: 'untracked' })
  })

  it('carries the source path of a rename', async () => {
    const renamed = byPath(await status(), 'new name.txt')

    expect(renamed).toMatchObject({ index: 'renamed', origPath: 'old name.txt' })
  })

  it('fails as a value on a directory that is not a repository', async () => {
    const result = (await handlers['git:status'](event, plain)) as GitStatusResult

    expect(result.ok).toBe(false)
  })

  it('diffs the working tree against the index', async () => {
    const result = await diff('tracked.txt')

    expect(result).toMatchObject({
      ok: true,
      diff: { original: 'one\n', modified: 'one\ntwo\n', kind: 'text', staged: false }
    })
  })

  it('diffs the index against HEAD when staged', async () => {
    const result = await diff('staged.txt', true)

    // Added: nothing at HEAD, the staged body on the modified side.
    expect(result).toMatchObject({
      ok: true,
      diff: { original: '', modified: 'staged body\n', staged: true }
    })
  })

  it('shows a deleted file as an empty modified side', async () => {
    const result = await diff('gone.txt')

    expect(result).toMatchObject({ ok: true, diff: { original: 'bye\n', modified: '' } })
  })

  it('shows an untracked file as an empty original side', async () => {
    const result = await diff('untracked.txt')

    expect(result).toMatchObject({ ok: true, diff: { original: '', modified: 'fresh\n' } })
  })

  it('refuses to decode a binary file', async () => {
    const result = await diff('blob.bin')

    expect(result).toMatchObject({ ok: true, diff: { kind: 'binary', original: '', modified: '' } })
  })

  it('accepts an absolute path inside the project', async () => {
    const result = await diff(join(dirty, 'tracked.txt'))

    expect(result).toMatchObject({ ok: true, diff: { path: 'tracked.txt' } })
  })

  it('rejects a path that escapes the project', async () => {
    const result = await diff('../repo/file.txt')

    expect(result).toEqual({ ok: false, error: 'Path is outside the project' })
  })
})
