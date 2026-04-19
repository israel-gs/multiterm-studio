/** @vitest-environment node */
import { describe, test, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { osc7ShellHook, zshIntegrationDir } from '../../../src/main/sidecar/shell-init'

// Temp dirs created during tests — cleaned up in afterEach.
const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mts-shell-init-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  }
})

describe('osc7ShellHook', () => {
  test('returns a non-empty string for zsh', () => {
    const hook = osc7ShellHook('zsh')
    expect(typeof hook).toBe('string')
    expect((hook as string).length).toBeGreaterThan(0)
  })

  test('zsh hook defines __mts_osc7 function', () => {
    const hook = osc7ShellHook('zsh')
    expect(hook).toContain('__mts_osc7')
  })

  test('zsh hook appends to precmd_functions', () => {
    const hook = osc7ShellHook('zsh')
    expect(hook).toContain('precmd_functions')
  })

  test('zsh hook ends with clear', () => {
    const hook = osc7ShellHook('zsh') as string
    expect(hook.trimEnd()).toMatch(/clear\s*$/)
  })

  test('returns a non-empty string for bash', () => {
    const hook = osc7ShellHook('bash')
    expect(typeof hook).toBe('string')
    expect((hook as string).length).toBeGreaterThan(0)
  })

  test('bash hook wraps PROMPT_COMMAND', () => {
    const hook = osc7ShellHook('bash') as string
    expect(hook).toContain('PROMPT_COMMAND')
  })

  test('bash hook ends with clear', () => {
    const hook = osc7ShellHook('bash') as string
    expect(hook.trimEnd()).toMatch(/clear\s*$/)
  })

  test('returns a non-empty string for sh (treated like bash)', () => {
    const hook = osc7ShellHook('sh')
    expect(typeof hook).toBe('string')
    expect((hook as string).length).toBeGreaterThan(0)
  })

  test('sh hook wraps PROMPT_COMMAND', () => {
    const hook = osc7ShellHook('sh') as string
    expect(hook).toContain('PROMPT_COMMAND')
  })

  test('returns null for fish', () => {
    expect(osc7ShellHook('fish')).toBeNull()
  })

  test('returns null for unknown shells', () => {
    expect(osc7ShellHook('tcsh')).toBeNull()
  })
})

describe('zshIntegrationDir', () => {
  test('returns a directory path that exists after the call', () => {
    const base = makeTempDir()
    const dir = zshIntegrationDir(undefined, base)
    expect(existsSync(dir)).toBe(true)
  })

  test('contains a .zshrc file', () => {
    const base = makeTempDir()
    const dir = zshIntegrationDir(undefined, base)
    expect(existsSync(join(dir, '.zshrc'))).toBe(true)
  })

  test('.zshrc restores real ZDOTDIR via _MTS_ZDOTDIR marker', () => {
    const base = makeTempDir()
    const dir = zshIntegrationDir('/Users/me/.config/zsh', base)
    const zshrc = readFileSync(join(dir, '.zshrc'), 'utf8')
    expect(zshrc).toContain('_MTS_ZDOTDIR')
  })

  test('.zshrc sources user real .zshrc when realZdotdir is provided', () => {
    const base = makeTempDir()
    const realZdotdir = '/Users/me/.config/zsh'
    const dir = zshIntegrationDir(realZdotdir, base)
    const zshrc = readFileSync(join(dir, '.zshrc'), 'utf8')
    expect(zshrc).toContain(realZdotdir)
  })

  test('.zshrc defines __mts_osc7 function', () => {
    const base = makeTempDir()
    const dir = zshIntegrationDir(undefined, base)
    const zshrc = readFileSync(join(dir, '.zshrc'), 'utf8')
    expect(zshrc).toContain('__mts_osc7')
  })

  test('.zshrc appends __mts_osc7 to precmd_functions', () => {
    const base = makeTempDir()
    const dir = zshIntegrationDir(undefined, base)
    const zshrc = readFileSync(join(dir, '.zshrc'), 'utf8')
    expect(zshrc).toContain('precmd_functions')
  })

  test('dir is placed under the provided base directory', () => {
    const base = makeTempDir()
    const dir = zshIntegrationDir(undefined, base)
    expect(dir.startsWith(base)).toBe(true)
  })

  test('calling twice with same args returns a stable path', () => {
    const base = makeTempDir()
    const dir1 = zshIntegrationDir(undefined, base)
    const dir2 = zshIntegrationDir(undefined, base)
    expect(dir1).toBe(dir2)
  })
})
