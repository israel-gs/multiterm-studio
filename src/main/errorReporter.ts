/**
 * Reporting for failures the user needs to know about.
 *
 * Persistence in this app is deliberately non-fatal: a failed layout write must
 * not take the window down. That turned into swallowing the error entirely, so
 * a read-only volume or a full disk silently discarded the user's work and
 * nothing ever said so.
 *
 * The sink is injected rather than importing electron here, so these modules
 * stay usable from tests without an electron mock.
 */

export interface ReportedError {
  /** Short, user-facing description of what failed. */
  message: string
  /** Technical detail for the log — not shown prominently. */
  detail?: string
}

type ErrorSink = (error: ReportedError) => void

let sink: ErrorSink | null = null

/** Registers where reported errors go. Called once from the main entry point. */
export function setErrorSink(fn: ErrorSink | null): void {
  sink = fn
}

/**
 * How long the same failure is muted after being reported.
 *
 * Saves are debounced but frequent; a persistently failing disk would otherwise
 * produce a notification per keystroke-ish interval.
 */
const THROTTLE_MS = 30_000

const lastReported = new Map<string, number>()

/** @internal Only for tests. */
export function _resetErrorThrottleForTests(): void {
  lastReported.clear()
}

/**
 * Reports a failure once per throttle window, keyed by `key`.
 *
 * Always logs; only forwards to the sink when the key is not muted.
 */
export function reportError(key: string, message: string, cause?: unknown): void {
  const detail = cause instanceof Error ? cause.message : cause ? String(cause) : undefined
  console.error(`[${key}] ${message}${detail ? `: ${detail}` : ''}`)

  const now = Date.now()
  const last = lastReported.get(key) ?? 0
  if (now - last < THROTTLE_MS) return
  lastReported.set(key, now)

  sink?.({ message, detail })
}
