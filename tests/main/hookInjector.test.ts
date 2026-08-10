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
    // Ours is added alongside; theirs survives untouched.
    const allow = (local.permissions as { allow: string[] }).allow
    expect(allow).toContain('Bash(ls:*)')
    expect(allow).toContain('mcp__multiterm-goals__goal_get')
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

  it('reclaims its own entry after another writer dropped the marker', async () => {
    // Found in the wild: something rewrote settings.local.json and normalised
    // our entry, dropping the `_source` key it did not recognise. The next
    // inject no longer saw its own hook and added a second one, so every hook
    // fired twice — silently, because a duplicate hook just repeats the work.
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const settings = readJson(localSettings())
    const hooks = settings.hooks as Record<string, Array<Record<string, unknown>>>
    for (const entries of Object.values(hooks)) for (const entry of entries) delete entry._source
    writeFileSync(localSettings(), JSON.stringify(settings))

    await injectHooks(project)

    const after = readJson(localSettings()).hooks as Record<string, unknown[]>
    expect(after.SessionStart).toHaveLength(1)
    expect(after.PostToolUse).toHaveLength(1)
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

describe('the session goal the hook injects', () => {
  // The script is a string in the source, so the only way to know it works is
  // to run it the way Claude Code does: payload on stdin, context on stdout.
  async function runHook(
    payload: Record<string, unknown>,
    env: Record<string, string> = {}
  ): Promise<string> {
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)
    const script = join(home, '.multiterm-studio', 'hooks', 'multiterm-notify.cjs')

    const { execFileSync } = await import('child_process')
    return execFileSync(process.execPath, [script], {
      input: JSON.stringify(payload),
      // HOME is redirected too: the script resolves its own state directory at
      // runtime, and a test must not write into the real ~/.multiterm-studio.
      env: { ...process.env, HOME: home, ...env },
      encoding: 'utf-8'
    })
  }

  function writeGoals(goals: unknown): void {
    mkdirSync(join(project, '.multiterm'), { recursive: true })
    writeFileSync(join(project, '.multiterm', 'goals.json'), JSON.stringify(goals))
  }

  it('registers UserPromptSubmit, the hook that re-states the goal each turn', async () => {
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const hooks = readJson(localSettings()).hooks as Record<string, unknown[]>
    expect(hooks.UserPromptSubmit).toHaveLength(1)
  })

  it('registers the goal tools and gitignores the file that does it', async () => {
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')

    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const mcp = readJson(join(project, '.mcp.json')) as {
      mcpServers: Record<string, { args: string[] }>
    }
    expect(mcp.mcpServers['multiterm-goals'].args[0]).toContain('multiterm-goals.cjs')
    expect(readFileSync(join(project, '.gitignore'), 'utf-8')).toContain('.mcp.json')
  })

  it('pre-approves only the goal tool that reads', async () => {
    // Asking permission to look up what it is supposed to be doing is exactly
    // the interruption the goal exists to prevent. Writing still prompts.
    const { injectHooks } = await import('../../src/main/hookInjector')
    await injectHooks(project)

    const allow = (readJson(localSettings()).permissions as { allow: string[] }).allow
    expect(allow).toEqual(['mcp__multiterm-goals__goal_get'])
  })

  it('prints the goal of the tile the terminal belongs to', async () => {
    writeGoals({
      project: { text: 'Ship the release', updatedAt: 0 },
      tiles: { 'tile-a': { text: 'Migrate the git panel', updatedAt: 0 } }
    })

    const out = await runHook(
      { hook_event_name: 'UserPromptSubmit', cwd: project },
      { MULTITERM_PTY_SESSION_ID: 'tile-a' }
    )

    expect(out).toContain('<session-goal>')
    expect(out).toContain('Migrate the git panel')
    expect(out).not.toContain('Ship the release')
  })

  it('falls back to the project goal for a tile that has none', async () => {
    writeGoals({ project: { text: 'Ship the release', updatedAt: 0 }, tiles: {} })

    const out = await runHook(
      { hook_event_name: 'UserPromptSubmit', cwd: project },
      { MULTITERM_PTY_SESSION_ID: 'tile-unknown' }
    )

    expect(out).toContain('Ship the release')
  })

  it('finds the goal from a subdirectory of the project', async () => {
    writeGoals({ project: { text: 'Ship the release', updatedAt: 0 }, tiles: {} })
    const deep = join(project, 'src', 'components')
    mkdirSync(deep, { recursive: true })

    const out = await runHook({ hook_event_name: 'UserPromptSubmit', cwd: deep })

    expect(out).toContain('Ship the release')
  })

  it('stays silent when no goal is set', async () => {
    const out = await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project })
    expect(out).toBe('')
  })

  it('re-injects the goal on SessionStart, which covers resume and compaction', async () => {
    writeGoals({ project: { text: 'Ship the release', updatedAt: 0 }, tiles: {} })

    const out = await runHook({
      hook_event_name: 'SessionStart',
      cwd: project,
      session_id: 's1'
    })

    expect(out).toContain('Ship the release')
    // The goal is announced by Claude, not printed at the user by the hook, so
    // the opening block has to ask for that explicitly.
    expect(out).toContain('Open your first reply by stating')
    expect(out).toContain('goal_complete')
  })

  it('renders the checklist with its progress', async () => {
    writeGoals({
      project: null,
      tiles: {
        'tile-a': {
          text: 'Migrate the git panel',
          steps: [
            { text: 'move the store', done: true },
            { text: 'update the tests', done: false }
          ],
          status: 'active',
          updatedAt: 1
        }
      }
    })

    const out = await runHook(
      { hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' },
      { MULTITERM_PTY_SESSION_ID: 'tile-a' }
    )

    expect(out).toContain('Checklist (1/2 done)')
    expect(out).toContain('1. [x] move the store')
    expect(out).toContain('2. [ ] update the tests')
  })

  it('injects a goal that is nothing but a checklist', async () => {
    writeGoals({
      project: null,
      tiles: {
        'tile-a': {
          text: '',
          steps: [
            { text: 'list the films', done: false },
            { text: 'say where to stream each', done: false }
          ],
          status: 'active',
          updatedAt: 1
        }
      }
    })

    const out = await runHook(
      { hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' },
      { MULTITERM_PTY_SESSION_ID: 'tile-a' }
    )

    expect(out).toContain('Checklist (0/2 done)')
    expect(out).toContain('list the films')
  })

  it('says nothing about a goal that is already met', async () => {
    // Re-stating a finished objective only invites the agent to redo the work.
    writeGoals({
      project: { text: 'Ship the release', status: 'done', updatedAt: 1, completedAt: 2 },
      tiles: {}
    })

    const out = await runHook({
      hook_event_name: 'UserPromptSubmit',
      cwd: project,
      session_id: 's1'
    })

    expect(out).toBe('')
  })

  describe('while a proposal waits on the user', () => {
    const withProposal = (proposal: unknown): unknown => ({
      project: {
        text: 'Ship the release',
        steps: [],
        status: 'active',
        updatedAt: 1,
        proposal
      },
      tiles: {}
    })

    it('tells the agent its proposal is unanswered, not accepted', async () => {
      writeGoals(withProposal({ kind: 'complete', summary: 'All done.', at: 5 }))

      const out = await runHook({
        hook_event_name: 'UserPromptSubmit',
        cwd: project,
        session_id: 's1'
      })

      expect(out).toContain('<session-goal-proposal>')
      expect(out).toContain('has not answered')
      expect(out).toContain('do not propose it again')
    })

    it('does not repeat the reminder after every tool call', async () => {
      writeGoals(withProposal({ kind: 'complete', summary: 'All done.', at: 5 }))

      const out = await runHook({
        hook_event_name: 'PostToolUse',
        cwd: project,
        session_id: 's1',
        tool_name: 'Read'
      })

      expect(out).toBe('')
    })

    it('reports a rejection once, then goes back to the plain restatement', async () => {
      writeGoals({
        project: {
          text: 'Ship the release',
          steps: [],
          status: 'active',
          updatedAt: 1,
          rejection: { kind: 'complete', at: 9 }
        },
        tiles: {}
      })

      const first = await runHook({
        hook_event_name: 'UserPromptSubmit',
        cwd: project,
        session_id: 's1'
      })
      const second = await runHook({
        hook_event_name: 'UserPromptSubmit',
        cwd: project,
        session_id: 's1'
      })

      expect(first).toContain('<session-goal-rejected>')
      expect(first).toContain('ask them what is missing')
      expect(second).not.toContain('<session-goal-rejected>')
      expect(second).toContain('Ship the release')
    })

    it('carries a proposal filed by a tile that inherits the project goal', async () => {
      // The tile has no objective of its own, so the proposal would otherwise
      // be invisible to the very session waiting on it.
      writeGoals({
        project: { text: 'Ship the release', steps: [], status: 'active', updatedAt: 1 },
        tiles: {
          'tile-a': {
            text: '',
            steps: [],
            status: 'active',
            updatedAt: 1,
            proposal: { kind: 'change', text: 'Fix the parser', reason: 'blocked', at: 5 }
          }
        }
      })

      const out = await runHook(
        { hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' },
        { MULTITERM_PTY_SESSION_ID: 'tile-a' }
      )

      expect(out).toContain('<session-goal-proposal>')
      expect(out).toContain('Fix the parser')
    })
  })

  describe('when the goal changes mid-session', () => {
    function goalAt(text: string, updatedAt: number): unknown {
      return { project: { text, steps: [], status: 'active', updatedAt }, tiles: {} }
    }

    it('announces the change rather than restating the new goal as if it were old', async () => {
      writeGoals(goalAt('Ship the release', 1))
      await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' })

      writeGoals(goalAt('Fix the parser instead', 2))
      const out = await runHook({
        hook_event_name: 'UserPromptSubmit',
        cwd: project,
        session_id: 's1'
      })

      expect(out).toContain('<session-goal-changed>')
      expect(out).toContain('Previous: Ship the release')
      expect(out).toContain('Fix the parser instead')
    })

    it('reaches a turn already in flight through PostToolUse', async () => {
      // This is the only hook that fires mid-turn, so it is the only way a goal
      // changed while the agent is working can reach it before the next prompt.
      writeGoals(goalAt('Ship the release', 1))
      await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' })

      writeGoals(goalAt('Fix the parser instead', 2))
      const out = await runHook({
        hook_event_name: 'PostToolUse',
        cwd: project,
        session_id: 's1',
        tool_name: 'Read'
      })

      const payload = JSON.parse(out.split('\n')[0])
      expect(payload.hookSpecificOutput.hookEventName).toBe('PostToolUse')
      expect(payload.hookSpecificOutput.additionalContext).toContain('Fix the parser instead')
    })

    it('stays quiet on PostToolUse while the goal is unchanged', async () => {
      writeGoals(goalAt('Ship the release', 1))
      await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' })

      const out = await runHook({
        hook_event_name: 'PostToolUse',
        cwd: project,
        session_id: 's1',
        tool_name: 'Read'
      })

      expect(out).toBe('')
    })

    it('announces a change only once', async () => {
      writeGoals(goalAt('Ship the release', 1))
      await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' })

      writeGoals(goalAt('Fix the parser instead', 2))
      await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' })
      const second = await runHook({
        hook_event_name: 'UserPromptSubmit',
        cwd: project,
        session_id: 's1'
      })

      expect(second).not.toContain('<session-goal-changed>')
      expect(second).toContain('Fix the parser instead')
    })

    it('does not mistake another session’s state for its own', async () => {
      writeGoals(goalAt('Ship the release', 1))
      await runHook({ hook_event_name: 'UserPromptSubmit', cwd: project, session_id: 's1' })

      writeGoals(goalAt('Fix the parser instead', 2))
      const other = await runHook({
        hook_event_name: 'UserPromptSubmit',
        cwd: project,
        session_id: 's2'
      })

      // s2 never saw the old goal, so for it nothing changed.
      expect(other).not.toContain('<session-goal-changed>')
    })
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
