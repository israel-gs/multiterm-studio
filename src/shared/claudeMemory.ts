/**
 * The instruction files Claude Code loads, in the order it loads them.
 *
 * They do not override each other: everything discovered is concatenated into
 * context, from the filesystem root down to the working directory. So the
 * question worth answering is not "which one wins" but "what is in there, how
 * much of the context window does it cost, and is any of it silently dropped".
 */

export type MemoryKind =
  | 'managed'
  | 'user'
  | 'user-rule'
  | 'project'
  | 'project-local'
  | 'rule'
  | 'auto-memory'

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  managed: 'Managed policy',
  user: 'User',
  'user-rule': 'User rule',
  project: 'Project',
  'project-local': 'Local',
  rule: 'Project rule',
  'auto-memory': 'Auto memory'
}

export interface MemoryFile {
  path: string
  kind: MemoryKind
  exists: boolean
  lines: number
  bytes: number
  /**
   * Rules with a `paths:` frontmatter only load when Claude touches a matching
   * file, so they are not part of the startup cost.
   */
  conditionalOn?: string[]
  /** `@path` imports found in the file, and whether each one resolves. */
  imports: Array<{ raw: string; path: string; exists: boolean }>
  /** Excluded by `claudeMdExcludes`, so Claude Code never reads it. */
  excluded?: boolean
  /** Why this file is worth looking at, when something is off. */
  warning?: string
}

export interface MemoryReport {
  files: MemoryFile[]
  /** Lines loaded at the start of every session, across all unconditional files. */
  startupLines: number
}

/** Over this, the docs say adherence starts to suffer. */
export const CLAUDE_MD_SOFT_LIMIT = 200

/** MEMORY.md is truncated past these, and the rest is silently dropped. */
export const MEMORY_INDEX_LINE_LIMIT = 200
export const MEMORY_INDEX_BYTE_LIMIT = 25 * 1024
