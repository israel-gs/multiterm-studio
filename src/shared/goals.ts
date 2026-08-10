/**
 * The objective a session is supposed to serve, shared by the main process
 * (which stores it), the renderer (which edits it) and the generated scripts
 * (which inject it into the agent and let the agent act on it).
 */
export interface GoalStep {
  text: string
  done: boolean
}

/**
 * A change the agent wants to make, waiting for the user to accept it.
 *
 * The agent never closes or rewrites a goal directly. Relying on Claude Code's
 * permission prompt for that turned out to be wrong: a session running in
 * bypass mode has no prompts at all, and the confirmation quietly vanished.
 * Holding the proposal here makes it the app's decision, in every mode.
 */
export interface GoalProposal {
  kind: 'complete' | 'change'
  /** For `complete`: what the agent says it accomplished. */
  summary?: string
  /** For `change`: the objective it wants instead, and why. */
  text?: string
  steps?: GoalStep[]
  reason?: string
  at: number
}

export interface Goal {
  /** The objective itself — the headline, without the steps. */
  text: string
  /** Empty for a one-line goal; a checklist otherwise. */
  steps: GoalStep[]
  status: 'active' | 'done'
  /** Epoch millis of the last edit, and what tells a session the goal moved. */
  updatedAt: number
  completedAt?: number
  /** What the agent claimed when it asked to close the goal. */
  claim?: string
  /** Set by the agent, cleared when the user accepts or rejects it. */
  proposal?: GoalProposal
  /** The last proposal the user turned down, so the agent can be told once. */
  rejection?: { kind: 'complete' | 'change'; at: number }
}

/**
 * Goals for one project: one per tile, plus an optional project-wide one used
 * when a tile has not set its own.
 */
export interface GoalFile {
  project: Goal | null
  tiles: Record<string, Goal>
}

/** Longer than this and the goal stops being a goal and becomes a briefing. */
export const MAX_GOAL_LENGTH = 2000

/** The goal that applies to a tile: its own, or the project's as a fallback. */
export function effectiveGoal(goals: GoalFile, tileId: string | null): Goal | null {
  if (tileId && goals.tiles[tileId]) return goals.tiles[tileId]
  return goals.project
}

/**
 * Splits what the user typed into a headline and a checklist.
 *
 * Bullet lines become steps, so a goal can grow from one sentence into a list
 * without the dialog needing a second editing mode:
 *
 *   Migrate the git panel      → text
 *   - move the store           → steps[0]
 *   - update the tests         → steps[1]
 */
export function parseGoalInput(raw: string): { text: string; steps: GoalStep[] } {
  const headline: string[] = []
  const steps: GoalStep[] = []

  for (const line of raw.split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      // A checked box survives a round trip through the editor.
      const checked = /^\[[xX]\]\s*/.test(bullet[1])
      const text = bullet[1].replace(/^\[[ xX]\]\s*/, '').trim()
      if (text) steps.push({ text, done: checked })
    } else if (line.trim()) {
      headline.push(line.trim())
    }
  }

  return { text: headline.join(' ').slice(0, MAX_GOAL_LENGTH), steps }
}

/**
 * A goal is only empty when it has neither a headline nor steps.
 *
 * A pure checklist — every line a bullet, no headline — is a perfectly ordinary
 * way to write an objective, and must not be mistaken for a request to clear it.
 */
export function isEmptyGoal(goal: { text: string; steps: GoalStep[] }): boolean {
  return !goal.text && goal.steps.length === 0
}

/** The inverse of `parseGoalInput`, for putting a goal back in the editor. */
export function formatGoalInput(goal: Goal | null): string {
  if (!goal) return ''
  const lines = goal.text ? [goal.text] : []
  for (const step of goal.steps) lines.push(`- ${step.done ? '[x] ' : ''}${step.text}`)
  return lines.join('\n')
}

/** What to call a goal that is nothing but a checklist. */
export function goalHeadline(goal: Goal): string {
  if (goal.text) return goal.text
  const [first] = goal.steps
  if (!first) return ''
  return goal.steps.length > 1 ? `${first.text} (+${goal.steps.length - 1} more)` : first.text
}

/**
 * Carries the checked state of the old steps onto the edited ones.
 *
 * Without this, fixing a typo in the headline would silently uncheck every step
 * the agent had already worked through.
 */
export function mergeStepState(previous: GoalStep[], next: GoalStep[]): GoalStep[] {
  const wasDone = new Map(previous.map((s) => [s.text, s.done]))
  return next.map((s) => ({ ...s, done: s.done || (wasDone.get(s.text) ?? false) }))
}

/** `2/5`, or null when the goal is a single line with no checklist. */
export function stepProgress(goal: Goal): { done: number; total: number } | null {
  if (goal.steps.length === 0) return null
  return { done: goal.steps.filter((s) => s.done).length, total: goal.steps.length }
}
