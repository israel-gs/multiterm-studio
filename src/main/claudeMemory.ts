import { readdir, readFile, stat } from 'fs/promises'
import { dirname, isAbsolute, join, resolve } from 'path'
import { homedir, platform } from 'os'
import {
  CLAUDE_MD_SOFT_LIMIT,
  MEMORY_INDEX_BYTE_LIMIT,
  MEMORY_INDEX_LINE_LIMIT,
  type MemoryFile,
  type MemoryKind,
  type MemoryReport
} from '../shared/claudeMemory'

function managedMemoryPath(): string {
  switch (platform()) {
    case 'darwin':
      return '/Library/Application Support/ClaudeCode/CLAUDE.md'
    case 'win32':
      return 'C:\\Program Files\\ClaudeCode\\CLAUDE.md'
    default:
      return '/etc/claude-code/CLAUDE.md'
  }
}

/**
 * Where Claude Code keeps the memory it writes for itself.
 *
 * The directory name is the project path with its separators replaced, which is
 * how all worktrees of one repository end up sharing a single directory.
 */
export function autoMemoryDir(folderPath: string): string {
  const slug = folderPath.replace(/\//g, '-')
  return join(homedir(), '.claude', 'projects', slug, 'memory')
}

/** Frontmatter `paths:` entries, which make a rule load only on demand. */
function conditionalPaths(content: string): string[] | undefined {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(content)
  if (!frontmatter) return undefined
  const block = /paths:\s*\n((?:\s*-\s*.*\n?)+)/.exec(frontmatter[1])
  if (!block) return undefined
  const paths = block[1]
    .split('\n')
    .map((line) =>
      /^\s*-\s*(.*)$/
        .exec(line)?.[1]
        ?.trim()
        .replace(/^["']|["']$/g, '')
    )
    .filter((value): value is string => !!value)
  return paths.length > 0 ? paths : undefined
}

/**
 * `@path` imports, which are expanded into context at launch.
 *
 * Import parsing skips code spans and fenced blocks, so a path mentioned in
 * backticks is text rather than an import — matching that keeps the panel from
 * reporting imports the user never wrote.
 */
async function findImports(content: string, fileDir: string): Promise<MemoryFile['imports']> {
  const stripped = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const imports: MemoryFile['imports'] = []
  const seen = new Set<string>()

  for (const match of stripped.matchAll(/(^|\s)@([^\s)]+)/g)) {
    const raw = match[2]
    if (seen.has(raw)) continue
    seen.add(raw)

    const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw
    const path = isAbsolute(expanded) ? expanded : resolve(fileDir, expanded)
    imports.push({ raw, path, exists: await exists(path) })
  }
  return imports
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function describe(path: string, kind: MemoryKind): Promise<MemoryFile> {
  let content: string
  try {
    content = await readFile(path, 'utf-8')
  } catch {
    return { path, kind, exists: false, lines: 0, bytes: 0, imports: [] }
  }

  const lines = content.split('\n').length
  const bytes = Buffer.byteLength(content, 'utf-8')
  const file: MemoryFile = {
    path,
    kind,
    exists: true,
    lines,
    bytes,
    imports: await findImports(content, dirname(path)),
    ...(conditionalPaths(content) ? { conditionalOn: conditionalPaths(content) } : {})
  }

  // The auto-memory index is truncated on load, and what falls past the limit
  // is dropped without a word.
  if (kind === 'auto-memory' && path.endsWith('MEMORY.md')) {
    if (lines > MEMORY_INDEX_LINE_LIMIT || bytes > MEMORY_INDEX_BYTE_LIMIT) {
      file.warning = `Only the first ${MEMORY_INDEX_LINE_LIMIT} lines or 25KB are loaded — the rest is dropped on every session.`
    }
  } else if (lines > CLAUDE_MD_SOFT_LIMIT && !file.conditionalOn) {
    file.warning = `Over ${CLAUDE_MD_SOFT_LIMIT} lines. Long instruction files cost context and are followed less consistently.`
  }

  const brokenImports = file.imports.filter((i) => !i.exists)
  if (brokenImports.length > 0) {
    file.warning = `${brokenImports.length} import${brokenImports.length > 1 ? 's do' : ' does'} not resolve: ${brokenImports.map((i) => i.raw).join(', ')}`
  }

  return file
}

async function markdownFilesIn(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const path = join(dir, entry.name)
      // Rules are discovered recursively, so subdirectories count.
      if (entry.isDirectory()) files.push(...(await markdownFilesIn(path)))
      else if (entry.name.endsWith('.md')) files.push(path)
    }
    return files.sort()
  } catch {
    return []
  }
}

/**
 * Everything Claude Code would load as instructions for this project.
 *
 * Ordered the way it reads them: managed policy, then the user's own, then the
 * project's, then anything local — with rules and auto memory alongside.
 */
export async function resolveMemory(
  folderPath: string,
  excludes: string[] = []
): Promise<MemoryReport> {
  const candidates: Array<{ path: string; kind: MemoryKind }> = [
    { path: managedMemoryPath(), kind: 'managed' },
    { path: join(homedir(), '.claude', 'CLAUDE.md'), kind: 'user' },
    ...(await markdownFilesIn(join(homedir(), '.claude', 'rules'))).map((path) => ({
      path,
      kind: 'user-rule' as const
    })),
    { path: join(folderPath, 'CLAUDE.md'), kind: 'project' },
    { path: join(folderPath, '.claude', 'CLAUDE.md'), kind: 'project' },
    { path: join(folderPath, 'CLAUDE.local.md'), kind: 'project-local' },
    ...(await markdownFilesIn(join(folderPath, '.claude', 'rules'))).map((path) => ({
      path,
      kind: 'rule' as const
    })),
    { path: join(autoMemoryDir(folderPath), 'MEMORY.md'), kind: 'auto-memory' },
    ...(await markdownFilesIn(autoMemoryDir(folderPath)))
      .filter((path) => !path.endsWith('MEMORY.md'))
      .map((path) => ({ path, kind: 'auto-memory' as const }))
  ]

  const files: MemoryFile[] = []
  for (const candidate of candidates) {
    const file = await describe(candidate.path, candidate.kind)
    if (!file.exists) {
      // Only the two the user is most likely to want to create are worth a row.
      if (candidate.kind === 'project' || candidate.kind === 'user') files.push(file)
      continue
    }
    if (excludes.some((pattern) => matchesExclude(file.path, pattern))) file.excluded = true
    files.push(file)
  }

  const startupLines = files
    .filter((f) => f.exists && !f.excluded && !f.conditionalOn && f.kind !== 'auto-memory')
    .reduce((total, f) => total + f.lines, 0)

  return { files, startupLines }
}

/** `claudeMdExcludes` patterns are globs matched against the absolute path. */
function matchesExclude(path: string, pattern: string): boolean {
  const source = pattern
    .split('**')
    .map((part) => part.split('*').map(escapeRegex).join('[^/]*'))
    .join('[\\s\\S]*')
  return new RegExp(`^${source}$`).test(path)
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
