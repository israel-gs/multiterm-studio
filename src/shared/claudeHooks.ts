import type { Scope } from './claudeConfig'

/** One registered hook command, and where it came from. */
export interface HookEntry {
  event: string
  /** Which tools it fires for; absent for events that take no matcher. */
  matcher?: string
  command: string
  timeout?: number
  scope: Scope
  /**
   * True for the hooks Multiterm injects itself.
   *
   * Worth separating: they appear in the user's settings without the user
   * having written them, and "what is this doing in my config?" deserves an
   * answer other than silence.
   */
  ours: boolean
}

/** One firing of the Multiterm hook, as recorded by the script itself. */
export interface HookRun {
  /** Epoch millis. */
  at: number
  event: string
  /** Tool name for PostToolUse and PreToolUse, absent otherwise. */
  tool?: string
  /** How long the script took, in milliseconds. */
  ms: number
  /** True when the run injected something into the model's context. */
  injected?: boolean
  /** Present when the script failed; a hook that fails today does so silently. */
  error?: string
}

export interface HookReport {
  entries: HookEntry[]
  /** Most recent first. */
  runs: HookRun[]
  /** Set when `disableAllHooks` is on, because then none of this runs. */
  disabledBy?: Scope
}

/** The order the panel lists events in: lifecycle first, then tool traffic. */
export const HOOK_EVENT_ORDER = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionEnd'
]

export function sortEvents(events: string[]): string[] {
  return [...events].sort((a, b) => {
    const ia = HOOK_EVENT_ORDER.indexOf(a)
    const ib = HOOK_EVENT_ORDER.indexOf(b)
    if (ia === -1 && ib === -1) return a.localeCompare(b)
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
}
