/**
 * Claude Code's permission rules, parsed, linted and matched.
 *
 * The rules look simple and are not: evaluation is deny → ask → allow with the
 * first match winning regardless of specificity, Bash patterns have a word
 * boundary that depends on whether a space precedes the wildcard, compound
 * commands must match subcommand by subcommand, and several tools accept path
 * rules that are then never consulted.
 *
 * Everything here is modelled on the documented behaviour. Where the answer
 * cannot be known for certain, the result says so rather than guessing.
 */

export type RuleKind = 'allow' | 'deny' | 'ask'

export interface ParsedRule {
  raw: string
  tool: string
  /** The text inside the parentheses, or null for a bare tool name. */
  specifier: string | null
}

export function parseRule(raw: string): ParsedRule {
  const match = /^([^(]+)\((.*)\)$/s.exec(raw.trim())
  if (!match) return { raw, tool: raw.trim(), specifier: null }
  return { raw, tool: match[1].trim(), specifier: match[2] }
}

// ── Linting ──────────────────────────────────────────────────────────────────

export interface RuleWarning {
  rule: string
  message: string
  /** `dead` means the rule never has any effect at all. */
  severity: 'dead' | 'suspect'
}

/** Tools whose path rules Claude Code accepts and then never consults. */
const UNCHECKED_PATH_TOOLS: Record<string, string> = {
  Write: 'Edit',
  NotebookEdit: 'Edit',
  MultiEdit: 'Edit',
  Glob: 'Read'
}

/** Primary content fields, which cannot be matched as parameters. */
const PRIMARY_FIELDS: Record<string, string> = {
  Bash: 'command',
  PowerShell: 'command',
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Grep: 'path',
  Glob: 'path',
  NotebookEdit: 'notebook_path',
  WebFetch: 'url'
}

/**
 * Reports rules that do not do what they look like they do.
 *
 * Every one of these is documented behaviour that produces a startup warning
 * or silent no-op — which is to say, nobody ever sees it.
 */
export function lintRule(raw: string, kind: RuleKind): RuleWarning[] {
  const warnings: RuleWarning[] = []
  const { tool, specifier } = parseRule(raw)

  if (specifier !== null && UNCHECKED_PATH_TOOLS[tool] && !specifier.includes(':')) {
    warnings.push({
      rule: raw,
      severity: 'dead',
      message: `File permissions are only checked against Read() and Edit(). A ${tool}() path rule is never consulted — write ${UNCHECKED_PATH_TOOLS[tool]}(${specifier}) instead.`
    })
  }

  if (specifier?.includes(':')) {
    const colon = specifier.indexOf(':')
    const field = specifier.slice(0, colon).trim()
    if (PRIMARY_FIELDS[tool] === field) {
      warnings.push({
        rule: raw,
        severity: 'dead',
        message: `A rule on ${tool}'s primary field is ignored, because a compound command could slip past it. Use ${tool}(${specifier.slice(colon + 1)}) instead.`
      })
    }
  }

  if (kind === 'allow' && tool.includes('*')) {
    // Allow globs are only honoured after a literal mcp__<server>__ prefix.
    const anchored = /^mcp__[^*]+__/.test(tool)
    if (!anchored) {
      warnings.push({
        rule: raw,
        severity: 'dead',
        message: `An unanchored wildcard in an allow rule is skipped and approves nothing. Only mcp__<server>__* is honoured.`
      })
    }
  }

  if (specifier && specifier.includes(':*') && !specifier.endsWith(':*')) {
    warnings.push({
      rule: raw,
      severity: 'suspect',
      message: `":*" is only a wildcard at the end of a pattern. Here the colon is matched literally, so this rule matches nothing.`
    })
  }

  return warnings
}

// ── Bash command matching ────────────────────────────────────────────────────

/** Separators after which a fresh command begins; each must match on its own. */
const SEPARATORS = ['&&', '||', '|&', ';', '|', '&', '\n']

/**
 * Splits a compound command, respecting quotes.
 *
 * A rule must match every subcommand independently, so `safe && rm -rf /` is
 * not covered by a rule that only permits `safe`.
 */
export function splitCompound(command: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | null = null

  for (let i = 0; i < command.length; i++) {
    const char = command[i]

    if (quote) {
      current += char
      if (char === quote && command[i - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    const separator = SEPARATORS.find((s) => command.startsWith(s, i))
    if (separator) {
      parts.push(current.trim())
      current = ''
      i += separator.length - 1
      continue
    }
    current += char
  }

  parts.push(current.trim())
  return parts.filter(Boolean)
}

/** Wrappers Claude Code strips before matching, because each runs its argument. */
const STRIPPED_WRAPPERS = new Set([
  'timeout',
  'time',
  'nice',
  'nohup',
  'stdbuf',
  'command',
  'builtin',
  'noglob'
])

/**
 * Wrappers that always prompt: a prefix rule cannot auto-approve them.
 * `find` joins them only in its `-exec` and `-delete` forms.
 */
const ALWAYS_PROMPT = new Set(['watch', 'setsid', 'ionice', 'flock'])

/** Commands Claude Code treats as read-only and runs without asking. */
const READ_ONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'echo',
  'pwd',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'which',
  'diff',
  'stat',
  'du',
  'cd'
])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/

export interface StrippedCommand {
  command: string
  /** True when a leading `VAR=value` was dropped to reach the command. */
  hadAssignment: boolean
}

/**
 * Removes the wrappers and assignments Claude Code looks past.
 *
 * `stripAssignments` is false for allow rules: those only match past a fixed
 * set of known-safe variables, which is not published, so the caller is told
 * the verdict may be more permissive in reality rather than being given a
 * confident wrong answer.
 */
export function stripCommand(command: string, stripAssignments: boolean): StrippedCommand {
  let current = command.trim()
  let hadAssignment = false

  for (let i = 0; i < 8; i++) {
    const assignment = ASSIGNMENT.exec(current)
    if (assignment) {
      hadAssignment = true
      if (!stripAssignments) break
      current = current.slice(assignment[0].length).trim()
      continue
    }

    const [head, ...rest] = current.split(/\s+/)
    if (STRIPPED_WRAPPERS.has(head) && rest.length > 0) {
      current = rest.join(' ')
      continue
    }
    // Bare xargs only: with flags it is matched as an xargs command itself.
    if (head === 'xargs' && rest.length > 0 && !rest[0].startsWith('-')) {
      current = rest.join(' ')
      continue
    }
    break
  }

  return { command: current, hadAssignment }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compiles a Bash pattern.
 *
 * A `*` preceded by a space at the end of the pattern enforces a word
 * boundary: `ls *` matches `ls -la` and `ls`, but never `lsof`. A `*` without
 * that space does not, which is the difference between a useful rule and one
 * that quietly matches more than intended.
 */
export function bashPatternToRegex(pattern: string): RegExp {
  // `:*` at the end is the same as a trailing ` *`, and only there.
  const normalised = pattern.endsWith(':*') ? `${pattern.slice(0, -2)} *` : pattern

  let source = ''
  for (let i = 0; i < normalised.length; i++) {
    const char = normalised[i]
    if (char !== '*') {
      source += escapeRegex(char)
      continue
    }
    const trailing = i === normalised.length - 1
    if (trailing && normalised[i - 1] === ' ') {
      // Drop the space we already emitted and make the whole tail optional.
      source = source.slice(0, -escapeRegex(' ').length) + '(?:\\s[\\s\\S]*)?'
      continue
    }
    source += '[\\s\\S]*'
  }
  return new RegExp(`^${source}$`)
}

// ── Path matching ────────────────────────────────────────────────────────────

export interface PathContext {
  /** Where the session is running. */
  cwd: string
  /** The directory a `/pattern` in this rule's scope anchors to. */
  settingsBase: string
  home: string
}

/** Resolves the four anchoring forms into an absolute glob. */
export function resolvePathPattern(pattern: string, ctx: PathContext): string {
  if (pattern.startsWith('//')) return pattern.slice(1)
  if (pattern.startsWith('~/')) return `${ctx.home}/${pattern.slice(2)}`
  // A single leading slash anchors at the settings source, not the filesystem.
  if (pattern.startsWith('/')) return `${ctx.settingsBase}${pattern}`
  const relative = pattern.startsWith('./') ? pattern.slice(2) : pattern
  return `${ctx.cwd}/${relative}`
}

/** gitignore-style globbing, enough for the path forms rules use. */
export function pathPatternToRegex(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` spans directories, including none at all.
        if (pattern[i + 2] === '/') {
          source += '(?:[^/]*(?:/|$))*'
          i += 2
        } else {
          source += '[\\s\\S]*'
          i += 1
        }
        continue
      }
      source += '[^/]*'
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += escapeRegex(char)
  }
  return new RegExp(`^${source}$`)
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export interface RuleWithScope {
  rule: string
  kind: RuleKind
  /** Only used to resolve `/pattern`; any label the caller likes. */
  settingsBase?: string
}

export interface ToolCall {
  tool: string
  /** Bash command, or the file path for Read/Edit, or the URL for WebFetch. */
  argument: string
}

export interface MatchResult {
  verdict: 'deny' | 'ask' | 'allow' | 'prompt'
  /** The rule that decided it, if any. */
  rule?: RuleWithScope
  /** Why, in one line — including when nothing matched. */
  reason: string
  /** Set when the real answer could differ from this one. */
  caveat?: string
}

function toolNameMatches(pattern: string, tool: string): boolean {
  if (pattern === tool) return true
  if (!pattern.includes('*')) return false
  return new RegExp(`^${pattern.split('*').map(escapeRegex).join('[\\s\\S]*')}$`).test(tool)
}

/**
 * Does one rule cover this call?
 *
 * Returns null when the rule does not apply at all, so the caller can keep
 * looking, and a caveat when the verdict is honest but not certain.
 */
function ruleMatches(
  rule: RuleWithScope,
  call: ToolCall,
  ctx: PathContext
): { matched: boolean; caveat?: string } {
  const { tool, specifier } = parseRule(rule.rule)
  if (!toolNameMatches(tool, call.tool)) return { matched: false }

  // A bare tool name, or Tool(*), covers every use of it.
  if (specifier === null || specifier === '*') return { matched: true }

  if (call.tool === 'Bash' || call.tool === 'PowerShell') {
    const subcommands = splitCompound(call.argument)
    const pattern = bashPatternToRegex(specifier)
    let caveat: string | undefined

    // Every subcommand must be covered, or the rule does not apply.
    for (const sub of subcommands) {
      const stripped = stripCommand(sub, rule.kind !== 'allow')
      if (!pattern.test(stripped.command)) return { matched: false }
      if (stripped.hadAssignment && rule.kind === 'allow') {
        caveat =
          'The command starts with an environment assignment. Claude Code looks past a fixed set of known-safe variables, so this may be allowed in practice.'
      }
    }
    return { matched: true, caveat }
  }

  if (call.tool === 'Read' || call.tool === 'Edit') {
    const resolved = resolvePathPattern(specifier, {
      ...ctx,
      settingsBase: rule.settingsBase ?? ctx.settingsBase
    })
    return { matched: pathPatternToRegex(resolved).test(call.argument) }
  }

  // Everything else — WebFetch(domain:…), parameter matches — is compared
  // literally, with `*` as a wildcard.
  return { matched: bashPatternToRegex(specifier).test(call.argument) }
}

/**
 * The verdict Claude Code would reach for this call.
 *
 * Order is deny, then ask, then allow, and the first match wins: a narrower
 * allow rule never rescues a call a broad deny already caught.
 */
export function evaluate(call: ToolCall, rules: RuleWithScope[], ctx: PathContext): MatchResult {
  const firstMatch = (kind: RuleKind): MatchResult | null => {
    for (const rule of rules.filter((r) => r.kind === kind)) {
      const { matched, caveat } = ruleMatches(rule, call, ctx)
      if (matched)
        return { verdict: kind, rule, reason: `Matched ${kind} rule ${rule.rule}`, caveat }
    }
    return null
  }

  // Deny and ask are checked first, and the first match wins outright.
  const blocked = firstMatch('deny') ?? firstMatch('ask')
  if (blocked) return blocked

  if (call.tool === 'Bash') {
    const heads = splitCompound(call.argument).map(
      (sub) => stripCommand(sub, true).command.split(/\s+/)[0]
    )

    // These beat an allow rule rather than falling through to it: a prefix
    // rule cannot pre-approve them, so checking them after allow would report
    // "allowed" for a call Claude Code stops to ask about.
    if (heads.some((head) => ALWAYS_PROMPT.has(head))) {
      return {
        verdict: 'prompt',
        reason:
          'Exec wrappers such as watch, setsid, ionice and flock always prompt — a prefix rule cannot pre-approve them.'
      }
    }
    if (heads.includes('find') && /\s-(?:exec|delete)\b/.test(call.argument)) {
      return {
        verdict: 'prompt',
        reason: 'find with -exec or -delete always prompts, even under a Bash(find *) rule.'
      }
    }

    const allowed = firstMatch('allow')
    if (allowed) return allowed

    if (heads.length > 0 && heads.every((head) => READ_ONLY_COMMANDS.has(head))) {
      return {
        verdict: 'allow',
        reason: 'Built-in read-only command — Claude Code runs these without asking.'
      }
    }
    return { verdict: 'prompt', reason: 'No rule matches, so Claude Code asks you.' }
  }

  return (
    firstMatch('allow') ?? {
      verdict: 'prompt',
      reason: 'No rule matches, so Claude Code asks you.'
    }
  )
}
