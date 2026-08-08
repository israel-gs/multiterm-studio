/**
 * "3 days ago" — the same shape git itself prints, in the coarsest useful unit.
 *
 * `now` is a parameter so the result is testable without freezing the clock.
 */
export function relativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - timestamp))
  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [604800, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute']
  ]

  for (const [size, name] of units) {
    const value = Math.floor(seconds / size)
    if (value >= 1) return `${value} ${name}${value === 1 ? '' : 's'} ago`
  }
  return 'just now'
}
