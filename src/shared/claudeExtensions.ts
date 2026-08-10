/** Skills, subagents, commands and MCP servers available to this project. */

export type ExtensionKind = 'skill' | 'agent' | 'command'

export const EXTENSION_LABELS: Record<ExtensionKind, string> = {
  skill: 'Skills',
  agent: 'Subagents',
  command: 'Commands'
}

export interface Extension {
  kind: ExtensionKind
  /** From the frontmatter when present, otherwise the file or folder name. */
  name: string
  description?: string
  path: string
  /** `user` for ~/.claude, `project` for the checkout. */
  origin: 'user' | 'project'
}

export interface McpServerEntry {
  name: string
  /** stdio, http, sse — whatever the entry declares. */
  transport: string
  /** The command or URL, for a stdio or remote server respectively. */
  target: string
  /** `.mcp.json` is the project file; `~/.claude.json` is yours alone. */
  source: 'project' | 'user'
  /**
   * True for the server Multiterm installs. It appears in the project without
   * the user having added it, so it says so.
   */
  ours: boolean
  /**
   * Project servers need approving before they load. Undefined means the
   * settings say nothing either way, and Claude Code will ask.
   */
  approved?: boolean
}

export interface ExtensionReport {
  extensions: Extension[]
  mcpServers: McpServerEntry[]
}
