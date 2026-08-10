/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  bashPatternToRegex,
  evaluate,
  lintRule,
  resolvePathPattern,
  splitCompound,
  stripCommand,
  type PathContext,
  type RuleWithScope
} from '../../src/shared/permissionRules'

/**
 * A permission tester that is wrong is worse than none: it would tell you a
 * command is blocked while the agent runs it. Every case here is documented
 * Claude Code behaviour.
 */

const ctx: PathContext = {
  cwd: '/repo',
  settingsBase: '/repo',
  home: '/Users/alice'
}

const rules = (...list: Array<[RuleWithScope['kind'], string]>): RuleWithScope[] =>
  list.map(([kind, rule]) => ({ kind, rule }))

describe('bash patterns', () => {
  it('enforces a word boundary when a space precedes the trailing wildcard', () => {
    // The difference between a useful rule and one that matches too much.
    const pattern = bashPatternToRegex('ls *')
    expect(pattern.test('ls -la')).toBe(true)
    expect(pattern.test('ls')).toBe(true)
    expect(pattern.test('lsof')).toBe(false)
  })

  it('does not enforce one without the space', () => {
    const pattern = bashPatternToRegex('ls*')
    expect(pattern.test('lsof')).toBe(true)
  })

  it('treats a trailing :* as the same as a trailing space-star', () => {
    expect(bashPatternToRegex('ls:*').test('ls -la')).toBe(true)
    expect(bashPatternToRegex('ls:*').test('lsof')).toBe(false)
  })

  it('lets one wildcard span several arguments', () => {
    expect(bashPatternToRegex('git * main').test('git push origin main')).toBe(true)
    expect(bashPatternToRegex('git * main').test('git merge main')).toBe(true)
  })

  it('matches an exact pattern exactly', () => {
    expect(bashPatternToRegex('npm run build').test('npm run build')).toBe(true)
    expect(bashPatternToRegex('npm run build').test('npm run build --watch')).toBe(false)
  })
})

describe('compound commands', () => {
  it('splits on every recognised separator', () => {
    expect(splitCompound('a && b || c ; d | e')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('does not split inside quotes', () => {
    expect(splitCompound('echo "a && b"')).toEqual(['echo "a && b"'])
  })

  it('requires every subcommand to be covered', () => {
    // The documented trap: an allow rule for one command must not sneak the
    // other one past.
    const result = evaluate(
      { tool: 'Bash', argument: 'npm test && rm -rf /' },
      rules(['allow', 'Bash(npm test *)']),
      ctx
    )
    expect(result.verdict).toBe('prompt')
  })
})

describe('wrapper stripping', () => {
  it('looks past wrappers that run their argument', () => {
    expect(stripCommand('timeout 30 npm test', true).command).toBe('30 npm test')
    expect(stripCommand('nohup npm test', true).command).toBe('npm test')
  })

  it('strips bare xargs but not xargs with flags', () => {
    expect(stripCommand('xargs grep pattern', true).command).toBe('grep pattern')
    expect(stripCommand('xargs -n1 grep pattern', true).command).toBe('xargs -n1 grep pattern')
  })

  it('reports an environment assignment an allow rule may not look past', () => {
    const stripped = stripCommand('NODE_ENV=test npm test', false)
    expect(stripped.hadAssignment).toBe(true)
    expect(stripped.command).toBe('NODE_ENV=test npm test')
  })

  it('matches past an assignment for deny, as Claude Code does', () => {
    const result = evaluate(
      { tool: 'Bash', argument: 'FOO=bar rm -rf tmp/' },
      rules(['deny', 'Bash(rm *)']),
      ctx
    )
    expect(result.verdict).toBe('deny')
  })

  it('says so when an allow verdict might be more permissive in reality', () => {
    const result = evaluate(
      { tool: 'Bash', argument: 'NODE_ENV=test npm test' },
      rules(['allow', 'Bash(npm test *)']),
      ctx
    )
    expect(result.verdict).toBe('prompt')
    expect(result.reason).toContain('No rule matches')
  })
})

describe('evaluation order', () => {
  it('lets a broad deny beat a narrow allow', () => {
    // Specificity does not enter into it: deny is simply checked first.
    const result = evaluate(
      { tool: 'Bash', argument: 'aws s3 ls' },
      rules(['allow', 'Bash(aws s3 ls)'], ['deny', 'Bash(aws *)']),
      ctx
    )
    expect(result.verdict).toBe('deny')
  })

  it('lets ask beat allow too', () => {
    const result = evaluate(
      { tool: 'Bash', argument: 'git push origin main' },
      rules(['allow', 'Bash(git push origin main)'], ['ask', 'Bash(git push *)']),
      ctx
    )
    expect(result.verdict).toBe('ask')
  })

  it('treats a bare tool name as covering every use', () => {
    const result = evaluate(
      { tool: 'Bash', argument: 'anything at all' },
      rules(['deny', 'Bash']),
      ctx
    )
    expect(result.verdict).toBe('deny')
  })

  it('falls through to a prompt when nothing matches', () => {
    const result = evaluate(
      { tool: 'Bash', argument: 'npm publish' },
      rules(['allow', 'Bash(npm test *)']),
      ctx
    )
    expect(result.verdict).toBe('prompt')
  })

  it('runs a built-in read-only command without asking', () => {
    const result = evaluate({ tool: 'Bash', argument: 'cat package.json' }, [], ctx)
    expect(result.verdict).toBe('allow')
    expect(result.reason).toContain('read-only')
  })

  it('prompts for an exec wrapper even when an allow rule matches the text', () => {
    // Bash(watch *) looks like it approves this, and does not: reporting
    // "allowed" here would be the tester lying about the one thing it is for.
    const result = evaluate(
      { tool: 'Bash', argument: 'watch npm test' },
      rules(['allow', 'Bash(watch *)']),
      ctx
    )
    expect(result.verdict).toBe('prompt')
    expect(result.reason).toContain('cannot pre-approve')
  })

  it('still lets a deny rule stop an exec wrapper', () => {
    const result = evaluate(
      { tool: 'Bash', argument: 'watch npm test' },
      rules(['deny', 'Bash(watch *)']),
      ctx
    )
    expect(result.verdict).toBe('deny')
  })

  it('prompts for find -delete even under a find rule', () => {
    const result = evaluate({ tool: 'Bash', argument: 'find . -name "*.tmp" -delete' }, [], ctx)
    expect(result.verdict).toBe('prompt')
    expect(result.reason).toContain('-exec')
  })
})

describe('path rules', () => {
  it('anchors a double slash at the filesystem root', () => {
    expect(resolvePathPattern('//Users/alice/secrets/**', ctx)).toBe('/Users/alice/secrets/**')
  })

  it('anchors a tilde at the home directory', () => {
    expect(resolvePathPattern('~/Documents/*.pdf', ctx)).toBe('/Users/alice/Documents/*.pdf')
  })

  it('anchors a single slash at the settings source, not the filesystem', () => {
    // The documented trap: /Users/alice/file is not an absolute path.
    expect(resolvePathPattern('/src/**/*.ts', ctx)).toBe('/repo/src/**/*.ts')
  })

  it('anchors a bare path at the working directory', () => {
    expect(resolvePathPattern('./.env', ctx)).toBe('/repo/.env')
  })

  it('denies a read of a file the pattern covers', () => {
    const result = evaluate(
      { tool: 'Read', argument: '/repo/.env' },
      rules(['deny', 'Read(./.env)']),
      ctx
    )
    expect(result.verdict).toBe('deny')
  })

  it('matches across directories with a double star', () => {
    const result = evaluate(
      { tool: 'Edit', argument: '/repo/src/api/handlers/user.ts' },
      rules(['allow', 'Edit(/src/**/*.ts)']),
      ctx
    )
    expect(result.verdict).toBe('allow')
  })

  it('does not let a single star cross a directory boundary', () => {
    const result = evaluate(
      { tool: 'Read', argument: '/repo/src/deep/file.ts' },
      rules(['allow', 'Read(/src/*.ts)']),
      ctx
    )
    expect(result.verdict).toBe('prompt')
  })
})

describe('linting rules that never fire', () => {
  it('flags a path rule on a tool whose paths are never checked', () => {
    const [warning] = lintRule('Write(docs/**)', 'allow')
    expect(warning.severity).toBe('dead')
    expect(warning.message).toContain('Edit(docs/**)')
  })

  it('flags a rule on a primary content field', () => {
    const [warning] = lintRule('Bash(command:rm *)', 'deny')
    expect(warning.severity).toBe('dead')
    expect(warning.message).toContain('compound command')
  })

  it('flags an unanchored wildcard in an allow rule', () => {
    expect(lintRule('mcp__*', 'allow')[0].severity).toBe('dead')
    // Anchored to a named server, it is honoured.
    expect(lintRule('mcp__puppeteer__*', 'allow')).toEqual([])
  })

  it('allows a tool-name wildcard in a deny rule', () => {
    expect(lintRule('mcp__*', 'deny')).toEqual([])
  })

  it('flags :* used anywhere but the end', () => {
    const [warning] = lintRule('Bash(git:* push)', 'allow')
    expect(warning.message).toContain('end of a pattern')
  })

  it('passes an ordinary rule without complaint', () => {
    expect(lintRule('Bash(npm run test:*)', 'allow')).toEqual([])
    expect(lintRule('Read(~/.zshrc)', 'allow')).toEqual([])
  })
})
