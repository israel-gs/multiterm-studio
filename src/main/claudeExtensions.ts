import { readdir, readFile } from 'fs/promises'
import type { Dirent } from 'fs'
import { basename, join } from 'path'
import { homedir } from 'os'
import type {
  Extension,
  ExtensionKind,
  ExtensionReport,
  McpServerEntry
} from '../shared/claudeExtensions'
import { GOAL_SERVER_NAME } from './goalMcpServer'

/** `name` and `description` out of the YAML frontmatter, if there is any. */
function frontmatter(content: string): { name?: string; description?: string } {
  const block = /^---\n([\s\S]*?)\n---/.exec(content)
  if (!block) return {}
  const read = (key: string): string | undefined => {
    const match = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block[1])
    return match?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined
  }
  return { name: read('name'), description: read('description') }
}

async function describe(
  path: string,
  kind: ExtensionKind,
  origin: 'user' | 'project',
  fallbackName: string
): Promise<Extension> {
  let meta: { name?: string; description?: string } = {}
  try {
    meta = frontmatter(await readFile(path, 'utf-8'))
  } catch {
    // A definition we cannot read still exists, and the row says so by name.
  }
  return {
    kind,
    name: meta.name ?? fallbackName,
    ...(meta.description ? { description: meta.description } : {}),
    path,
    origin
  }
}

/**
 * Reads one extension directory.
 *
 * Skills are folders holding a SKILL.md; agents and commands are plain markdown
 * files. Both layouts appear under `.claude`, so both are handled.
 */
async function readDir(
  dir: string,
  kind: ExtensionKind,
  origin: 'user' | 'project'
): Promise<Extension[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const found: Extension[] = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(await describe(join(path, 'SKILL.md'), kind, origin, entry.name))
    } else if (entry.name.endsWith('.md')) {
      found.push(await describe(path, kind, origin, basename(entry.name, '.md')))
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf-8'))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function serverEntries(
  servers: Record<string, unknown>,
  source: 'project' | 'user',
  approvals: { enabled: string[]; disabled: string[]; all: boolean }
): McpServerEntry[] {
  return Object.entries(servers).map(([name, raw]) => {
    const config = (raw ?? {}) as Record<string, unknown>
    const args = Array.isArray(config.args) ? config.args.map(String) : []
    const command = typeof config.command === 'string' ? config.command : ''
    return {
      name,
      transport: String(config.type ?? (config.url ? 'http' : 'stdio')),
      target: typeof config.url === 'string' ? config.url : [command, ...args].join(' ').trim(),
      source,
      ours: name === GOAL_SERVER_NAME,
      // Only project servers go through approval; a user-scoped one is yours.
      ...(source === 'project'
        ? {
            approved: approvals.disabled.includes(name)
              ? false
              : approvals.all || approvals.enabled.includes(name)
                ? true
                : undefined
          }
        : {})
    }
  })
}

/**
 * Everything this project adds to Claude Code beyond its settings: skills,
 * subagents, commands and MCP servers, from both the checkout and your home
 * directory.
 */
export async function resolveExtensions(folderPath: string): Promise<ExtensionReport> {
  const home = join(homedir(), '.claude')
  const local = join(folderPath, '.claude')

  const extensions = [
    ...(await readDir(join(local, 'skills'), 'skill', 'project')),
    ...(await readDir(join(home, 'skills'), 'skill', 'user')),
    ...(await readDir(join(local, 'agents'), 'agent', 'project')),
    ...(await readDir(join(home, 'agents'), 'agent', 'user')),
    ...(await readDir(join(local, 'commands'), 'command', 'project')),
    ...(await readDir(join(home, 'commands'), 'command', 'user'))
  ]

  // Approval of project servers is recorded in the settings files, so a server
  // can be present and still not be loading.
  const approvals = { enabled: [] as string[], disabled: [] as string[], all: false }
  for (const path of [join(local, 'settings.json'), join(local, 'settings.local.json')]) {
    const settings = await readJson(path)
    if (!settings) continue
    if (settings.enableAllProjectMcpServers === true) approvals.all = true
    if (Array.isArray(settings.enabledMcpjsonServers)) {
      approvals.enabled.push(...settings.enabledMcpjsonServers.map(String))
    }
    if (Array.isArray(settings.disabledMcpjsonServers)) {
      approvals.disabled.push(...settings.disabledMcpjsonServers.map(String))
    }
  }

  const mcpServers: McpServerEntry[] = []
  const projectMcp = await readJson(join(folderPath, '.mcp.json'))
  if (projectMcp?.mcpServers && typeof projectMcp.mcpServers === 'object') {
    mcpServers.push(
      ...serverEntries(projectMcp.mcpServers as Record<string, unknown>, 'project', approvals)
    )
  }

  // ~/.claude.json is Claude Code's own state file. It is read and never
  // written: it is rewritten during a session, and a concurrent write would
  // lose whatever it was holding.
  const userConfig = await readJson(join(homedir(), '.claude.json'))
  const perProject = (userConfig?.projects ?? {}) as Record<string, unknown>
  const thisProject = (perProject[folderPath] ?? {}) as Record<string, unknown>
  for (const servers of [userConfig?.mcpServers, thisProject.mcpServers]) {
    if (servers && typeof servers === 'object') {
      mcpServers.push(...serverEntries(servers as Record<string, unknown>, 'user', approvals))
    }
  }

  return { extensions, mcpServers }
}
