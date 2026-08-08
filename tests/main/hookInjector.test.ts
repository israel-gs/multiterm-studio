/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/**
 * The injector edits files inside the user's repository, so the properties that
 * matter are: never touch the committed settings.json, never leave generated
 * scripts in the checkout, and leave unrelated config untouched.
 */

let home: string
let project: string

// hookInjector resolves ~/.multiterm-studio at import time, so the home
// directory has to be redirected before the module is loaded.
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => process.env.MTS_TEST_HOME! }
})

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'))
}

const localSettings = (): string => join(project, '.claude', 'settings.local.json')
const sharedSettings = (): string => join(project, '.claude', 'settings.json')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'mts-home-'))
  process.env.MTS_TEST_HOME = home
  project = mkdtempSync(join(tmpdir(), 'mts-project-'))
  mkdirSync(join(project, '.claude'), { recursive: true })
  vi.resetModules()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
  delete process.env.MTS_TEST_HOME
})

describe('injectHooks', () => {
  it('registers in settings.local.json, not the committed settings.json', async () => {
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const local = readJson(localSettings())
    expect(Object.keys(local.hooks as object)).toEqual(
      expect.arrayContaining(['SessionStart', 'SessionEnd', 'PostToolUse', 'PreToolUse'])
    )
    expect(existsSync(sharedSettings())).toBe(false)
  })

  it('keeps the hook scripts out of the repository', async () => {
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    expect(existsSync(join(project, '.claude', 'hooks'))).toBe(false)
    expect(existsSync(join(home, '.multiterm-studio', 'hooks', 'multiterm-notify.cjs'))).toBe(true)
  })

  it('preserves unrelated settings and hooks owned by someone else', async () => {
    writeFileSync(
      localSettings(),
      JSON.stringify({
        permissions: { allow: ['Bash(ls:*)'] },
        hooks: { SessionStart: [{ _source: 'someone-else', hooks: [] }] }
      })
    )

    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const local = readJson(localSettings())
    expect(local.permissions).toEqual({ allow: ['Bash(ls:*)'] })
    const sessionStart = (local.hooks as Record<string, Array<{ _source: string }>>).SessionStart
    expect(sessionStart.some((e) => e._source === 'someone-else')).toBe(true)
    expect(sessionStart.some((e) => e._source === 'multiterm-studio')).toBe(true)
  })

  it('does not accumulate duplicate entries across runs', async () => {
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)
    await injectHooks(project)
    await injectHooks(project)

    const hooks = readJson(localSettings()).hooks as Record<string, unknown[]>
    expect(hooks.SessionStart).toHaveLength(1)
    expect(hooks.PostToolUse).toHaveLength(1)
  })

  it('migrates a project set up by an older version', async () => {
    // Old layout: entries in the committed file plus scripts in the checkout.
    writeFileSync(
      sharedSettings(),
      JSON.stringify({
        hooks: { SessionStart: [{ _source: 'multiterm-studio', hooks: [] }] },
        model: 'opus'
      })
    )
    mkdirSync(join(project, '.claude', 'hooks'), { recursive: true })
    writeFileSync(join(project, '.claude', 'hooks', 'multiterm-notify.cjs'), '// old')

    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const shared = readJson(sharedSettings())
    expect(shared.hooks).toBeUndefined() // our entry was the only one
    expect(shared.model).toBe('opus') // unrelated config survives
    expect(existsSync(join(project, '.claude', 'hooks'))).toBe(false)
  })
})

describe('removeHooks', () => {
  it('removes our entries and leaves the rest alone', async () => {
    const { injectHooks, removeHooks } = await import('../../src/main/hookInjector')
    writeFileSync(localSettings(), JSON.stringify({ permissions: { allow: [] } }))

    await injectHooks(project)
    await removeHooks(project)

    const local = readJson(localSettings())
    expect(local.hooks).toBeUndefined()
    expect(local.permissions).toEqual({ allow: [] })
  })

  it('does not rewrite a settings file it has nothing to remove from', async () => {
    writeFileSync(sharedSettings(), '{"model":"opus"}')
    const before = readFileSync(sharedSettings(), 'utf-8')

    const { removeHooks } = await import('../../src/main/hookInjector')
    await removeHooks(project)

    expect(readFileSync(sharedSettings(), 'utf-8')).toBe(before)
  })
})

describe('injectOpenCodeHooks — .gitignore handling', () => {
  // The plugin must live in the project (OpenCode only loads plugins from
  // there), so the generated file is added to .gitignore instead.
  beforeEach(() => {
    mkdirSync(join(home, '.opencode'), { recursive: true })
  })

  it('adds the generated plugin to .gitignore', async () => {
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')

    const { injectOpenCodeHooks } = await import('../../src/main/hookInjector')
    await injectOpenCodeHooks(project)

    const ignored = readFileSync(join(project, '.gitignore'), 'utf-8')
    expect(ignored).toContain('.opencode/plugins/multiterm-studio.js')
  })

  it('does not append again on a second open', async () => {
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')

    const { injectOpenCodeHooks } = await import('../../src/main/hookInjector')
    await injectOpenCodeHooks(project)
    const first = readFileSync(join(project, '.gitignore'), 'utf-8')
    await injectOpenCodeHooks(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf-8')).toBe(first)
  })

  it('leaves .gitignore alone when a broader rule already covers it', async () => {
    // Ignoring the whole directory is enough; appending would churn the file
    // on every project open.
    const original = 'node_modules\n.opencode/\n'
    writeFileSync(join(project, '.gitignore'), original)

    const { injectOpenCodeHooks } = await import('../../src/main/hookInjector')
    await injectOpenCodeHooks(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf-8')).toBe(original)
  })

  it('does not create a .gitignore where the project has none', async () => {
    const { injectOpenCodeHooks } = await import('../../src/main/hookInjector')
    await injectOpenCodeHooks(project)

    expect(existsSync(join(project, '.gitignore'))).toBe(false)
  })
})
