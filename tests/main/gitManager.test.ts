/** @vitest-environment node */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

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

let repo: string
let plain: string
const event = {}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'mts-git-'))
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
  rmSync(join(repo, '..'), { recursive: true, force: true })
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
