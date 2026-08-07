import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { shellQuote } from '../../src/renderer/src/utils/shellQuote'

/**
 * These values arrive over the JSON-RPC socket and end up on a shell command
 * line, so the quoting has to hold against real shell metacharacters — the
 * assertions below run the result through /bin/sh rather than trusting a regex.
 */
const HOSTILE = [
  'plain',
  '/path/with space/dir',
  "it's",
  '$(touch /tmp/pwned)',
  '`touch /tmp/pwned`',
  '"; touch /tmp/pwned; echo "',
  '$HOME',
  'a\nb',
  '*',
  'x & y | z > w'
]

/** Echoes the argument back through /bin/sh exactly as the shell parsed it. */
function roundTripThroughShell(value: string): string {
  return execFileSync('/bin/sh', ['-c', `printf %s ${shellQuote(value)}`]).toString()
}

describe('shellQuote', () => {
  it.each(HOSTILE)('passes %j through the shell unchanged', (value) => {
    expect(roundTripThroughShell(value)).toBe(value)
  })

  it('keeps a hostile value as a single argument', () => {
    const value = 'one two three'
    const argCount = execFileSync('/bin/sh', [
      '-c',
      `set -- ${shellQuote(value)}; printf %s "$#"`
    ]).toString()
    expect(argCount).toBe('1')
  })

  it('leaves substitutions unevaluated rather than running them', () => {
    // If the quoting leaked, the shell would run `echo` and print INJECTED;
    // quoted correctly it prints the substitution itself, verbatim.
    const out = roundTripThroughShell('$(echo INJECTED)')
    expect(out).toBe('$(echo INJECTED)')
  })

  it('does not let a crafted value start a second command', () => {
    // A value that tries to close the quote and append `echo INJECTED`.
    const out = roundTripThroughShell("'; echo INJECTED; :'")
    expect(out.split('\n')).toHaveLength(1)
    expect(out).toBe("'; echo INJECTED; :'")
  })
})
