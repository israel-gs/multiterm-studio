/** @vitest-environment node */
import { describe, test, expect } from 'vitest'
import { osc7ShellHook } from '../../../src/main/sidecar/shell-init'

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
