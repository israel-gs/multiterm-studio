/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadGoals,
  setGoal,
  pruneGoals,
  completeGoal,
  reopenGoal,
  setStepDone,
  approveProposal,
  rejectProposal
} from '../../src/main/sessionGoal'
import { effectiveGoal } from '../../src/shared/goals'

let project: string
const goalsFile = (): string => join(project, '.multiterm', 'goals.json')

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'mts-goals-'))
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

describe('session goals', () => {
  it('stores a goal per tile and reads it back', async () => {
    await setGoal(project, 'tile-a', 'Migrate the git panel')
    await setGoal(project, 'tile-b', 'Write the tests')

    const goals = await loadGoals(project)
    expect(goals.tiles['tile-a'].text).toBe('Migrate the git panel')
    expect(goals.tiles['tile-b'].text).toBe('Write the tests')
    expect(goals.project).toBeNull()
  })

  it('falls back to the project goal for a tile that has none', async () => {
    await setGoal(project, null, 'Ship the 1.3 release')
    await setGoal(project, 'tile-a', 'Write the tests')

    const goals = await loadGoals(project)
    expect(effectiveGoal(goals, 'tile-a')?.text).toBe('Write the tests')
    expect(effectiveGoal(goals, 'tile-b')?.text).toBe('Ship the 1.3 release')
    expect(effectiveGoal(goals, null)?.text).toBe('Ship the 1.3 release')
  })

  it('clears a goal when the text is empty', async () => {
    await setGoal(project, 'tile-a', 'Something')
    const after = await setGoal(project, 'tile-a', '   ')

    expect(after.tiles['tile-a']).toBeUndefined()
    // The last goal is gone, so nothing is left for the hook to open each turn.
    expect(existsSync(goalsFile())).toBe(false)
  })

  it('keeps the file when other goals remain', async () => {
    await setGoal(project, 'tile-a', 'A')
    await setGoal(project, null, 'Project wide')
    await setGoal(project, 'tile-a', '')

    expect(existsSync(goalsFile())).toBe(true)
    expect((await loadGoals(project)).project?.text).toBe('Project wide')
  })

  it('caps a goal that has grown into a briefing', async () => {
    await setGoal(project, 'tile-a', 'x'.repeat(5000))
    expect((await loadGoals(project)).tiles['tile-a'].text).toHaveLength(2000)
  })

  it('forgets goals of tiles that no longer exist', async () => {
    await setGoal(project, 'tile-a', 'A')
    await setGoal(project, 'tile-b', 'B')
    await setGoal(project, null, 'Project wide')

    const goals = await pruneGoals(project, ['tile-a'])
    expect(goals.tiles['tile-a']).toBeDefined()
    expect(goals.tiles['tile-b']).toBeUndefined()
    // Pruning is about closed tiles; the project goal is not a tile.
    expect(goals.project?.text).toBe('Project wide')
  })

  it('keeps completed goals when their tile is gone', async () => {
    // They are the history the goals panel shows, and a tile is usually closed
    // right after its objective was met.
    await setGoal(project, 'tile-a', 'Migrate the git panel')
    await completeGoal(project, 'tile-a', 'Done and merged.')

    const goals = await pruneGoals(project, [])
    expect(goals.tiles['tile-a'].status).toBe('done')
    expect(goals.tiles['tile-a'].claim).toBe('Done and merged.')
  })
})

describe('checklists', () => {
  it('splits bullet lines into steps', async () => {
    const goals = await setGoal(project, 'tile-a', 'Migrate the panel\n- move the store\n- retest')

    expect(goals.tiles['tile-a'].text).toBe('Migrate the panel')
    expect(goals.tiles['tile-a'].steps).toEqual([
      { text: 'move the store', done: false },
      { text: 'retest', done: false }
    ])
  })

  it('stores a goal that is nothing but a checklist', async () => {
    // Writing every line as a bullet, with no headline, is an ordinary way to
    // state an objective — it must not read as a request to clear the goal.
    const goals = await setGoal(project, 'tile-a', '- list the films\n- say where to stream each')

    expect(goals.tiles['tile-a']).toBeDefined()
    expect(goals.tiles['tile-a'].text).toBe('')
    expect(goals.tiles['tile-a'].steps).toHaveLength(2)
    expect(existsSync(goalsFile())).toBe(true)
  })

  it('survives a reload as a checklist-only goal', async () => {
    await setGoal(project, 'tile-a', '- list the films\n- say where to stream each')

    const reloaded = await loadGoals(project)
    expect(reloaded.tiles['tile-a'].steps.map((s) => s.text)).toEqual([
      'list the films',
      'say where to stream each'
    ])
  })

  it('keeps ticked steps ticked when the headline is edited', async () => {
    await setGoal(project, 'tile-a', 'Migrate the panel\n- move the store\n- retest')
    await setStepDone(project, 'tile-a', 0, true)

    const goals = await setGoal(
      project,
      'tile-a',
      'Migrate the git panel\n- move the store\n- retest'
    )
    expect(goals.tiles['tile-a'].steps[0].done).toBe(true)
    expect(goals.tiles['tile-a'].steps[1].done).toBe(false)
  })

  it('does not raise a change alarm when a save changed nothing', async () => {
    // updatedAt is what tells a running session the goal moved, so re-saving
    // identical text must not make every agent announce a change.
    const first = await setGoal(project, 'tile-a', 'Migrate the panel\n- move the store')
    const stamp = first.tiles['tile-a'].updatedAt

    const second = await setGoal(project, 'tile-a', 'Migrate the panel\n- move the store')
    expect(second.tiles['tile-a'].updatedAt).toBe(stamp)
  })
})

describe('completing a goal', () => {
  it('ticks every step, so a met goal never reads as half done', async () => {
    await setGoal(project, 'tile-a', 'Migrate\n- move the store\n- retest')
    const goals = await completeGoal(project, 'tile-a', 'All green.')

    expect(goals.tiles['tile-a'].status).toBe('done')
    expect(goals.tiles['tile-a'].steps.every((s) => s.done)).toBe(true)
    expect(goals.tiles['tile-a'].completedAt).toBeGreaterThan(0)
  })

  it('drops the claim when the goal is reopened', async () => {
    await setGoal(project, 'tile-a', 'Migrate')
    await completeGoal(project, 'tile-a', 'All green.')
    const goals = await reopenGoal(project, 'tile-a')

    expect(goals.tiles['tile-a'].status).toBe('active')
    expect(goals.tiles['tile-a'].claim).toBeUndefined()
    expect(goals.tiles['tile-a'].completedAt).toBeUndefined()
  })

  it('treats a corrupt file as no goals rather than throwing', async () => {
    mkdirSync(join(project, '.multiterm'), { recursive: true })
    writeFileSync(goalsFile(), '{ not json')

    expect(await loadGoals(project)).toEqual({ project: null, tiles: {} })
  })
})

describe('proposals from the agent', () => {
  /** What the MCP tools write: a proposal, never the change itself. */
  async function propose(tileId: string, proposal: unknown): Promise<void> {
    const goals = await loadGoals(project)
    const goal = goals.tiles[tileId]
    mkdirSync(join(project, '.multiterm'), { recursive: true })
    writeFileSync(
      goalsFile(),
      JSON.stringify({ ...goals, tiles: { [tileId]: { ...goal, proposal } } })
    )
  }

  it('leaves the goal untouched until the user accepts', async () => {
    // The whole point: with permission prompts bypassed, the app is the only
    // thing standing between the agent and a goal it declared finished.
    await setGoal(project, 'tile-a', 'Migrate the git panel')
    await propose('tile-a', { kind: 'complete', summary: 'All done.', at: Date.now() })

    const goals = await loadGoals(project)
    expect(goals.tiles['tile-a'].status).toBe('active')
    expect(goals.tiles['tile-a'].proposal?.summary).toBe('All done.')
  })

  it('closes the goal on approval, keeping what the agent claimed', async () => {
    await setGoal(project, 'tile-a', 'Migrate\n- move the store')
    await propose('tile-a', { kind: 'complete', summary: 'Store moved.', at: Date.now() })

    const goals = await approveProposal(project, 'tile-a')
    expect(goals.tiles['tile-a'].status).toBe('done')
    expect(goals.tiles['tile-a'].claim).toBe('Store moved.')
    expect(goals.tiles['tile-a'].steps[0].done).toBe(true)
    expect(goals.tiles['tile-a'].proposal).toBeUndefined()
  })

  it('applies a proposed change only on approval', async () => {
    await setGoal(project, 'tile-a', 'Old objective')
    await propose('tile-a', {
      kind: 'change',
      text: 'New objective',
      steps: [{ text: 'first step', done: false }],
      reason: 'the old one is done',
      at: Date.now()
    })

    expect((await loadGoals(project)).tiles['tile-a'].text).toBe('Old objective')

    const goals = await approveProposal(project, 'tile-a')
    expect(goals.tiles['tile-a'].text).toBe('New objective')
    expect(goals.tiles['tile-a'].steps).toEqual([{ text: 'first step', done: false }])
  })

  it('records a rejection so the agent can be told once', async () => {
    await setGoal(project, 'tile-a', 'Migrate the git panel')
    await propose('tile-a', { kind: 'complete', summary: 'All done.', at: Date.now() })

    const goals = await rejectProposal(project, 'tile-a')
    expect(goals.tiles['tile-a'].status).toBe('active')
    expect(goals.tiles['tile-a'].proposal).toBeUndefined()
    expect(goals.tiles['tile-a'].rejection?.kind).toBe('complete')
  })

  it('keeps an entry that holds nothing but a pending proposal', async () => {
    // A terminal inheriting the project goal has no goal of its own; the
    // proposal it files must still survive a reload.
    mkdirSync(join(project, '.multiterm'), { recursive: true })
    writeFileSync(
      goalsFile(),
      JSON.stringify({
        project: null,
        tiles: {
          'tile-a': {
            text: '',
            steps: [],
            status: 'active',
            updatedAt: 1,
            proposal: { kind: 'change', text: 'Something new', at: 2 }
          }
        }
      })
    )

    const goals = await loadGoals(project)
    expect(goals.tiles['tile-a'].proposal?.text).toBe('Something new')
  })

  it('treats a corrupt file as no goals rather than throwing', async () => {
    mkdirSync(join(project, '.multiterm'), { recursive: true })
    writeFileSync(goalsFile(), '{ not json')

    expect(await loadGoals(project)).toEqual({ project: null, tiles: {} })
  })
})
