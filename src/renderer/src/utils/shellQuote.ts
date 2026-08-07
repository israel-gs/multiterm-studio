/**
 * Quotes a string for safe use as a single argument in a POSIX shell.
 *
 * Anything typed into a PTY is executed by the user's shell, so values that
 * come from outside the app (agent names, transcript directories delivered over
 * the JSON-RPC socket) must never be pasted in raw: a value containing `"`,
 * backticks or `$(...)` would otherwise run arbitrary commands.
 *
 * Wrapping in single quotes disables every form of shell expansion; the only
 * character that needs care is the single quote itself, which is closed,
 * escaped and reopened.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
