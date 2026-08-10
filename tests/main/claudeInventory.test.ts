/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { HookReport } from '../../src/shared/claudeHooks'
import type { MemoryReport } from '../../src/shared/claudeMemory'
import type { ExtensionReport } from '../../src/shared/claudeExtensions'

/**
 * Hooks, instruction files and extensions: three inventories whose value is
 * reporting what a session cannot see — a hook that failed, a memory file that
 * is truncated on load, an MCP server sitting in the project unapproved.
 */

let home: string
let project: string

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => process.env.MTS_TEST_HOME! }
})

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
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

describe('hooks inventory', () => {
  async function resolve(): Promise<HookReport> {
    const { resolveHooks } = await import('../../src/main/claudeHooks')
    return resolveHooks(project)
  }

  it('lists every scope, because hooks all run together', async () => {
    write(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ command: 'mine.sh' }] }] } })
    )
    write(
      join(project, '.claude', 'settings.local.json'),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { matcher: 'Read|Edit', _source: 'multiterm-studio', hooks: [{ command: 'ours.cjs' }] }
          ]
        }
      })
    )

    const { entries } = await resolve()
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.command === 'mine.sh')).toMatchObject({
      scope: 'user',
      ours: false
    })
    expect(entries.find((e) => e.command === 'ours.cjs')).toMatchObject({
      scope: 'local',
      matcher: 'Read|Edit',
      ours: true
    })
  })

  it('reports disableAllHooks, which switches off everything below it', async () => {
    write(join(home, '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }))
    expect((await resolve()).disabledBy).toBe('user')
  })

  it('reads the run log newest first and survives a torn line', async () => {
    // The log is appended to by short-lived processes; a half-written line must
    // not lose the rest of the history.
    write(
      join(home, '.multiterm-studio', 'hook-log.jsonl'),
      [
        JSON.stringify({ at: 1, event: 'SessionStart', ms: 4 }),
        '{ half written',
        JSON.stringify({ at: 2, event: 'UserPromptSubmit', ms: 6, error: 'boom' })
      ].join('\n')
    )

    const { runs } = await resolve()
    expect(runs.map((r) => r.event)).toEqual(['UserPromptSubmit', 'SessionStart'])
    expect(runs[0].error).toBe('boom')
  })
})

describe('instruction files', () => {
  async function resolve(excludes: string[] = []): Promise<MemoryReport> {
    const { resolveMemory } = await import('../../src/main/claudeMemory')
    return resolveMemory(project, excludes)
  }

  it('counts what loads into every session', async () => {
    write(join(project, 'CLAUDE.md'), Array(30).fill('line').join('\n'))
    write(join(home, '.claude', 'CLAUDE.md'), Array(10).fill('line').join('\n'))

    expect((await resolve()).startupLines).toBe(40)
  })

  it('does not count a path-scoped rule, which loads on demand', async () => {
    write(join(project, 'CLAUDE.md'), 'one line')
    write(
      join(project, '.claude', 'rules', 'api.md'),
      '---\npaths:\n  - "src/api/**/*.ts"\n---\n\nRule body'
    )

    const report = await resolve()
    const rule = report.files.find((f) => f.path.endsWith('api.md'))
    expect(rule?.conditionalOn).toEqual(['src/api/**/*.ts'])
    expect(report.startupLines).toBe(1)
  })

  it('warns when an instruction file is long enough to hurt adherence', async () => {
    write(join(project, 'CLAUDE.md'), Array(250).fill('line').join('\n'))

    const file = (await resolve()).files.find((f) => f.path === join(project, 'CLAUDE.md'))
    expect(file?.warning).toContain('200 lines')
  })

  it('warns when the auto-memory index is past the limit that silently truncates', async () => {
    const { autoMemoryDir } = await import('../../src/main/claudeMemory')
    write(join(autoMemoryDir(project), 'MEMORY.md'), Array(260).fill('- entry').join('\n'))

    const file = (await resolve()).files.find((f) => f.path.endsWith('MEMORY.md'))
    expect(file?.warning).toContain('dropped')
  })

  it('reports an import that does not resolve', async () => {
    write(join(project, 'CLAUDE.md'), 'See @docs/missing.md for details')

    const file = (await resolve()).files.find((f) => f.path === join(project, 'CLAUDE.md'))
    expect(file?.imports[0]).toMatchObject({ raw: 'docs/missing.md', exists: false })
    expect(file?.warning).toContain('does not resolve')
  })

  it('does not mistake a backticked path for an import', async () => {
    // Import parsing skips code spans, so neither should this.
    write(join(project, 'CLAUDE.md'), 'Mention `@README` without importing it')

    const file = (await resolve()).files.find((f) => f.path === join(project, 'CLAUDE.md'))
    expect(file?.imports).toEqual([])
  })

  it('marks a file excluded by claudeMdExcludes', async () => {
    write(join(project, 'CLAUDE.md'), 'content')

    const report = await resolve([`${project}/**`])
    const file = report.files.find((f) => f.path === join(project, 'CLAUDE.md'))
    expect(file?.excluded).toBe(true)
    // Excluded means never read, so it costs nothing at startup.
    expect(report.startupLines).toBe(0)
  })
})

describe('extensions and MCP servers', () => {
  async function resolve(): Promise<ExtensionReport> {
    const { resolveExtensions } = await import('../../src/main/claudeExtensions')
    return resolveExtensions(project)
  }

  it('reads a skill folder and an agent file, name from the frontmatter', async () => {
    write(
      join(project, '.claude', 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\ndescription: Ship it\n---\n'
    )
    write(join(home, '.claude', 'agents', 'reviewer.md'), '---\ndescription: Reviews code\n---\n')

    const { extensions } = await resolve()
    expect(extensions).toContainEqual(
      expect.objectContaining({ kind: 'skill', name: 'deploy', description: 'Ship it' })
    )
    expect(extensions).toContainEqual(
      expect.objectContaining({ kind: 'agent', name: 'reviewer', origin: 'user' })
    )
  })

  it('marks a project MCP server that has not been approved', async () => {
    // It is in the file and not loading, which looks the same from a session.
    write(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { sentry: { type: 'http', url: 'https://example.com' } } })
    )

    const server = (await resolve()).mcpServers[0]
    expect(server.approved).toBeUndefined()
    expect(server.source).toBe('project')
  })

  it('reads the approval recorded in settings', async () => {
    write(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { sentry: {}, other: {} } }))
    write(
      join(project, '.claude', 'settings.local.json'),
      JSON.stringify({ enabledMcpjsonServers: ['sentry'], disabledMcpjsonServers: ['other'] })
    )

    const { mcpServers } = await resolve()
    expect(mcpServers.find((s) => s.name === 'sentry')?.approved).toBe(true)
    expect(mcpServers.find((s) => s.name === 'other')?.approved).toBe(false)
  })

  it('marks the server Multiterm installs as its own', async () => {
    write(
      join(project, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'multiterm-goals': { command: 'node' } } })
    )

    expect((await resolve()).mcpServers[0].ours).toBe(true)
  })
})
