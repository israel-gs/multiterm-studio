import { readFile, writeFile, rename, mkdir, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { randomUUID } from 'crypto'
import { reportError } from './errorReporter'
import {
  isEmptyGoal,
  MAX_GOAL_LENGTH,
  mergeStepState,
  parseGoalInput,
  type Goal,
  type GoalFile,
  type GoalProposal,
  type GoalStep
} from '../shared/goals'

/**
 * Goals live in a plain file rather than in app state because two of their
 * readers are separate processes the app does not own: the hook script Claude
 * Code spawns on every turn, and the MCP server it spawns for the session.
 * Neither can ask the renderer for anything.
 */
function goalPath(folderPath: string): string {
  return join(folderPath, '.multiterm', 'goals.json')
}

function parseSteps(raw: unknown): GoalStep[] {
  if (!Array.isArray(raw)) return []
  const steps: GoalStep[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const { text, done } = item as Partial<GoalStep>
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (trimmed) steps.push({ text: trimmed, done: done === true })
  }
  return steps
}

/**
 * Reads one stored goal. Tolerant by design: goals written before steps and
 * statuses existed load as plain active goals rather than disappearing.
 */
function parseGoal(raw: unknown): Goal | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<Goal>
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const steps = parseSteps(value.steps)
  const proposal = parseProposal(value.proposal)
  // A goal written as nothing but a checklist has no headline, and is still a
  // goal. An entry that holds only a pending proposal has neither, and must
  // survive too — otherwise the proposal is dropped before anyone sees it.
  if (!text && steps.length === 0 && !proposal) return null
  return {
    text,
    steps,
    status: value.status === 'done' ? 'done' : 'active',
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
    ...(typeof value.completedAt === 'number' ? { completedAt: value.completedAt } : {}),
    ...(typeof value.claim === 'string' && value.claim ? { claim: value.claim } : {}),
    ...(proposal ? { proposal } : {}),
    ...(value.rejection && typeof value.rejection.at === 'number'
      ? { rejection: value.rejection }
      : {})
  }
}

function parseProposal(raw: unknown): GoalProposal | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<GoalProposal>
  if (value.kind !== 'complete' && value.kind !== 'change') return null
  return {
    kind: value.kind,
    at: typeof value.at === 'number' ? value.at : 0,
    ...(typeof value.summary === 'string' ? { summary: value.summary } : {}),
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...(Array.isArray(value.steps) ? { steps: parseSteps(value.steps) } : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {})
  }
}

export async function loadGoals(folderPath: string): Promise<GoalFile> {
  try {
    const parsed = JSON.parse(await readFile(goalPath(folderPath), 'utf-8')) as Partial<GoalFile>
    const tiles: Record<string, Goal> = {}
    for (const [id, value] of Object.entries(parsed.tiles ?? {})) {
      const goal = parseGoal(value)
      if (goal) tiles[id] = goal
    }
    return { project: parseGoal(parsed.project), tiles }
  } catch {
    // No goals yet, or a file we cannot parse — same thing to the caller.
    return { project: null, tiles: {} }
  }
}

function read(goals: GoalFile, tileId: string | null): Goal | null {
  return tileId === null ? goals.project : (goals.tiles[tileId] ?? null)
}

function write(goals: GoalFile, tileId: string | null, goal: Goal | null): void {
  if (tileId === null) goals.project = goal
  else if (goal) goals.tiles[tileId] = goal
  else delete goals.tiles[tileId]
}

/**
 * Sets the goal for one tile, or for the project when `tileId` is null.
 *
 * Empty text clears that goal rather than storing a blank one: the hook reads
 * this file on every turn and an empty goal would inject an empty section.
 */
export async function setGoal(
  folderPath: string,
  tileId: string | null,
  raw: string
): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const previous = read(goals, tileId)
  const { text, steps } = parseGoalInput(raw.slice(0, MAX_GOAL_LENGTH * 2))

  if (isEmptyGoal({ text, steps })) {
    write(goals, tileId, null)
  } else {
    const unchanged = previous && previous.text === text && sameSteps(previous.steps, steps)
    write(goals, tileId, {
      text,
      steps: previous ? mergeStepState(previous.steps, steps) : steps,
      status: 'active',
      // Editing the wording is what tells a running session the goal moved, so
      // a save that changed nothing must not raise a false alarm.
      updatedAt: unchanged && previous ? previous.updatedAt : Date.now()
    })
  }

  await writeGoals(folderPath, goals)
  return goals
}

function sameSteps(a: GoalStep[], b: GoalStep[]): boolean {
  return a.length === b.length && a.every((step, i) => step.text === b[i].text)
}

/** Marks a goal completed, recording what was claimed on its behalf. */
export async function completeGoal(
  folderPath: string,
  tileId: string | null,
  claim: string
): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const goal = read(goals, tileId)
  if (!goal) return goals

  write(goals, tileId, {
    ...goal,
    status: 'done',
    completedAt: Date.now(),
    // A completed goal implies its steps are done; leaving them unchecked
    // would show a finished objective sitting at 2/5 in the panel.
    steps: goal.steps.map((s) => ({ ...s, done: true })),
    ...(claim.trim() ? { claim: claim.trim() } : {})
  })
  await writeGoals(folderPath, goals)
  return goals
}

/**
 * Accepts whatever the agent proposed for this goal.
 *
 * Closing or rewriting the objective only ever happens here, from a click in
 * the app — never from the tool call that asked for it.
 */
export async function approveProposal(
  folderPath: string,
  tileId: string | null
): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const goal = read(goals, tileId)
  const proposal = goal?.proposal
  if (!goal || !proposal) return goals

  if (proposal.kind === 'complete') {
    const accepted: Goal = {
      ...goal,
      status: 'done',
      completedAt: Date.now(),
      steps: goal.steps.map((s) => ({ ...s, done: true })),
      ...(proposal.summary ? { claim: proposal.summary } : {})
    }
    delete accepted.proposal
    write(goals, tileId, accepted)
  } else {
    const accepted: Goal = {
      text: proposal.text ?? goal.text,
      steps: proposal.steps ?? [],
      status: 'active',
      updatedAt: Date.now()
    }
    write(goals, tileId, accepted)
  }

  await writeGoals(folderPath, goals)
  return goals
}

/** Turns the proposal down, and leaves a mark so the agent gets told once. */
export async function rejectProposal(folderPath: string, tileId: string | null): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const goal = read(goals, tileId)
  const proposal = goal?.proposal
  if (!goal || !proposal) return goals

  const rejected: Goal = { ...goal, rejection: { kind: proposal.kind, at: Date.now() } }
  delete rejected.proposal
  write(goals, tileId, rejected)

  await writeGoals(folderPath, goals)
  return goals
}

/** Puts a completed goal back to work, dropping the claim that closed it. */
export async function reopenGoal(folderPath: string, tileId: string | null): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const goal = read(goals, tileId)
  if (!goal) return goals

  const reopened: Goal = { ...goal, status: 'active', updatedAt: Date.now() }
  // The claim and the completion time described a close that no longer stands.
  delete reopened.completedAt
  delete reopened.claim
  write(goals, tileId, reopened)
  await writeGoals(folderPath, goals)
  return goals
}

/** Ticks a single checklist step, addressed by its position. */
export async function setStepDone(
  folderPath: string,
  tileId: string | null,
  index: number,
  done: boolean
): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const goal = read(goals, tileId)
  if (!goal || index < 0 || index >= goal.steps.length) return goals

  const steps = goal.steps.map((s, i) => (i === index ? { ...s, done } : s))
  write(goals, tileId, { ...goal, steps })
  await writeGoals(folderPath, goals)
  return goals
}

/**
 * Drops goals belonging to tiles that no longer exist.
 *
 * Completed goals stay: they are the history the goals panel shows, and a tile
 * is usually closed right after its objective was met.
 */
export async function pruneGoals(folderPath: string, liveTileIds: string[]): Promise<GoalFile> {
  const goals = await loadGoals(folderPath)
  const live = new Set(liveTileIds)
  let changed = false
  for (const [id, goal] of Object.entries(goals.tiles)) {
    if (!live.has(id) && goal.status !== 'done') {
      delete goals.tiles[id]
      changed = true
    }
  }
  if (changed) await writeGoals(folderPath, goals)
  return goals
}

async function writeGoals(folderPath: string, goals: GoalFile): Promise<void> {
  const target = goalPath(folderPath)

  // Nothing left to store — remove the file instead of leaving an empty husk
  // the hook has to open on every turn.
  if (!goals.project && Object.keys(goals.tiles).length === 0) {
    try {
      await unlink(target)
    } catch {
      // already gone
    }
    return
  }

  const tmp = `${target}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, JSON.stringify(goals, null, 2), 'utf-8')
    await rename(tmp, target)
  } catch (err) {
    reportError('session-goal', 'Could not save the session goal', err)
    try {
      await unlink(tmp)
    } catch {
      /* ignore */
    }
  }
}
