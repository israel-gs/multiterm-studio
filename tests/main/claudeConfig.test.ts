/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ResolvedConfig, ResolvedSetting } from '../../src/shared/claudeConfig'

/**
 * Reading one settings file answers almost nothing: four scopes combine, and
 * they combine by two different rules. These tests pin the rules, because
 * getting them wrong means the panel confidently states the opposite of what
 * Claude Code is doing.
 */

let home: string
let project: string

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => process.env.MTS_TEST_HOME! }
})

function writeUser(settings: unknown): void {
  mkdirSync(join(home, '.claude'), { recursive: true })
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings))
}

function writeProject(settings: unknown): void {
  mkdirSync(join(project, '.claude'), { recursive: true })
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify(settings))
}

function writeLocal(settings: unknown): void {
  mkdirSync(join(project, '.claude'), { recursive: true })
  writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify(settings))
}

async function resolve(): Promise<ResolvedConfig> {
  const { resolveClaudeConfig } = await import('../../src/main/claudeConfig')
  return resolveClaudeConfig(project)
}

function setting(config: ResolvedConfig, key: string): ResolvedSetting | undefined {
  return config.settings.find((s) => s.key === key)
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mts-home-'))
  process.env.MTS_TEST_HOME = home
  project = mkdtempSync(join(tmpdir(), 'mts-project-'))
  vi.resetModules()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
  delete process.env.MTS_TEST_HOME
})

describe('resolving scalars', () => {
  it('lets the local scope override the project and the user', async () => {
    writeUser({ model: 'sonnet' })
    writeProject({ model: 'opus' })
    writeLocal({ model: 'haiku' })

    const model = setting(await resolve(), 'model')
    expect(model?.value).toBe('haiku')
    expect(model?.winner).toBe('local')
  })

  it('keeps what each losing scope said, highest first', async () => {
    // The point of the panel is answering "why is it this value?", which needs
    // the values it covered, not just the winner.
    writeUser({ model: 'sonnet' })
    writeProject({ model: 'opus' })
    writeLocal({ model: 'haiku' })

    const model = setting(await resolve(), 'model')
    expect(model?.shadowed).toEqual([
      { scope: 'project', value: 'opus' },
      { scope: 'user', value: 'sonnet' }
    ])
  })

  it('reports a setting only the user scope defines', async () => {
    writeUser({ editorMode: 'vim' })

    const mode = setting(await resolve(), 'editorMode')
    expect(mode?.winner).toBe('user')
    expect(mode?.shadowed).toEqual([])
  })
})

describe('resolving permissions', () => {
  it('merges the rules of every scope instead of the top one winning', async () => {
    writeUser({ permissions: { allow: ['Bash(ls:*)'] } })
    writeProject({ permissions: { allow: ['Bash(npm test)'] } })
    writeLocal({ permissions: { allow: ['Read(~/.zshrc)'] } })

    const allow = setting(await resolve(), 'permissions.allow')
    expect(allow?.mergeKind).toBe('merge')
    expect(allow?.value).toEqual(['Bash(ls:*)', 'Bash(npm test)', 'Read(~/.zshrc)'])
  })

  it('keeps the scope each rule came from', async () => {
    writeUser({ permissions: { allow: ['Bash(ls:*)'] } })
    writeLocal({ permissions: { deny: ['Read(./.env)'] } })

    const { permissions } = await resolve()
    expect(permissions).toContainEqual({ rule: 'Bash(ls:*)', kind: 'allow', scope: 'user' })
    expect(permissions).toContainEqual({ rule: 'Read(./.env)', kind: 'deny', scope: 'local' })
  })

  it('does not treat a permissions block as one opaque value', async () => {
    // allow merges while a sibling key would not, so the block has to be split.
    writeProject({ permissions: { allow: ['Bash(ls:*)'], deny: ['Bash(curl:*)'] } })

    const config = await resolve()
    expect(setting(config, 'permissions.allow')?.value).toEqual(['Bash(ls:*)'])
    expect(setting(config, 'permissions.deny')?.value).toEqual(['Bash(curl:*)'])
    expect(setting(config, 'permissions')).toBeUndefined()
  })
})

describe('resolving hooks', () => {
  it('reports every scope as live rather than picking a winner', async () => {
    // Hook entries merge across settings levels and all matching hooks run.
    // Showing the top scope as the winner would claim the user's own hooks had
    // been switched off — the opposite of what happens.
    writeUser({ hooks: { SessionStart: [{ hooks: [] }] } })
    writeLocal({ hooks: { PostToolUse: [{ hooks: [] }] } })

    const hooks = setting(await resolve(), 'hooks')
    expect(hooks?.mergeKind).toBe('additive')
    expect(hooks?.contributors).toEqual(['local', 'user'])
    expect(hooks?.shadowed).toEqual([])
  })
})

describe('editing permission rules', () => {
  async function edit(
    scope: 'user' | 'project' | 'local' | 'managed',
    kind: 'allow' | 'deny' | 'ask',
    rule: string,
    action: 'add' | 'remove'
  ): Promise<ResolvedConfig> {
    const { editPermissionRule } = await import('../../src/main/claudeConfig')
    return editPermissionRule(project, scope, kind, rule, action)
  }

  function readLocal(): Record<string, unknown> {
    return JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf-8'))
  }

  it('writes a new rule into the scope it was told to', async () => {
    const config = await edit('local', 'allow', 'Bash(npm test *)', 'add')

    expect(config.permissions).toContainEqual({
      rule: 'Bash(npm test *)',
      kind: 'allow',
      scope: 'local'
    })
    expect(readLocal()).toEqual({ permissions: { allow: ['Bash(npm test *)'] } })
  })

  it('leaves everything else in the file alone', async () => {
    writeLocal({ model: 'opus', permissions: { deny: ['Bash(curl *)'] } })
    await edit('local', 'allow', 'Bash(npm test *)', 'add')

    const local = readLocal()
    expect(local.model).toBe('opus')
    expect((local.permissions as Record<string, string[]>).deny).toEqual(['Bash(curl *)'])
  })

  it('does not add the same rule twice', async () => {
    await edit('local', 'allow', 'Bash(npm test *)', 'add')
    await edit('local', 'allow', 'Bash(npm test *)', 'add')

    expect((readLocal().permissions as Record<string, string[]>).allow).toEqual([
      'Bash(npm test *)'
    ])
  })

  it('removes a rule and tidies up after itself', async () => {
    await edit('local', 'allow', 'Bash(npm test *)', 'add')
    await edit('local', 'allow', 'Bash(npm test *)', 'remove')

    // An empty allow list, and an empty permissions block, are noise.
    expect(readLocal()).toEqual({})
  })

  it('refuses to touch managed settings', async () => {
    // They belong to whoever deploys them, and the edit would be undone anyway.
    await expect(edit('managed', 'allow', 'Bash(ls *)', 'add')).rejects.toThrow(/organisation/)
  })

  it('refuses to rewrite a file it could not parse', async () => {
    // Rewriting it would throw away whatever the user was in the middle of.
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.local.json'), '{ broken')

    await expect(edit('local', 'allow', 'Bash(ls *)', 'add')).rejects.toThrow(/not valid JSON/)
    expect(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf-8')).toBe('{ broken')
  })
})

describe('reporting the files themselves', () => {
  it('surfaces a settings file that is not valid JSON', async () => {
    // Claude Code skips it without a word, so this panel is the only place the
    // user learns their rules never applied.
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.json'), '{ "model": "opus", }}')

    const config = await resolve()
    const file = config.files.find((f) => f.scope === 'project')
    expect(file?.exists).toBe(true)
    expect(file?.parseError).toBeTruthy()
  })

  it('ignores the values of a broken file rather than half-reading it', async () => {
    writeUser({ model: 'sonnet' })
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.local.json'), 'not json at all')

    // The user value stands, exactly as Claude Code would have it.
    expect(setting(await resolve(), 'model')?.value).toBe('sonnet')
  })

  it('rejects a settings file that parses to something other than an object', async () => {
    mkdirSync(join(project, '.claude'), { recursive: true })
    writeFileSync(join(project, '.claude', 'settings.json'), '["not", "an", "object"]')

    const file = (await resolve()).files.find((f) => f.scope === 'project')
    expect(file?.parseError).toBe('Expected a JSON object')
  })

  it('lists every scope, present or not', async () => {
    const config = await resolve()
    expect(config.files.map((f) => f.scope)).toEqual(['user', 'project', 'local', 'managed'])
    expect(config.files.every((f) => !f.exists)).toBe(true)
    expect(config.settings).toEqual([])
  })
})
