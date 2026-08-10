import { describe, it, expect } from 'vitest'
import { buildGraph, laneColor } from '@renderer/utils/gitGraph'
import type { GitCommit } from '../../src/shared/git'

/**
 * Lane assignment is the whole graph: the drawing is a direct read of these
 * numbers, so the shapes worth checking are a straight line, a fork, a merge
 * and a lane being reused once it is free.
 */
function commit(sha: string, parents: string[] = []): GitCommit {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    authorName: 'Test',
    authorEmail: 'test@example.com',
    timestamp: 0,
    parents,
    refs: [],
    subject: sha,
    body: ''
  }
}

describe('buildGraph', () => {
  it('keeps a linear history in one lane', () => {
    const rows = buildGraph([commit('c', ['b']), commit('b', ['a']), commit('a')])

    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows.map((r) => r.width)).toEqual([1, 1, 1])
  })

  it('drops the lane after the root commit, which has no parent to hand it to', () => {
    const rows = buildGraph([commit('b', ['a']), commit('a')])

    expect(rows[1].parentLanes).toEqual([])
    expect(rows[1].lanesAfter).toEqual([])
  })

  it('gives a second branch its own lane', () => {
    // Two tips over a shared parent: the second tip cannot use lane 0.
    const rows = buildGraph([commit('tipA', ['base']), commit('tipB', ['base']), commit('base')])

    expect(rows[0].lane).toBe(0)
    expect(rows[1].lane).toBe(1)
    // Both reserved lane 0 for base, so base stays where the first tip put it.
    expect(rows[2].lane).toBe(0)
  })

  it('leaves a merge with a line to each parent', () => {
    const rows = buildGraph([
      commit('merge', ['main', 'feature']),
      commit('main', ['base']),
      commit('feature', ['base']),
      commit('base')
    ])

    expect(rows[0].lane).toBe(0)
    // First parent inherits the lane; the second one bends into a new lane.
    expect(rows[0].parentLanes).toEqual([0, 1])
    expect(rows[2].lane).toBe(1)
  })

  it('marks the lanes of branches that end at a commit, so they can bend into it', () => {
    // Both tips point at base: base is drawn in lane 0, and lane 1's line has
    // to curve into it rather than stop dead in the middle of the row.
    const rows = buildGraph([commit('tipA', ['base']), commit('tipB', ['base']), commit('base')])

    expect(rows[2].incomingLanes).toEqual([1])
    expect(rows[2].lane).toBe(0)
  })

  it('leaves no lane occupied above a row without something to draw it into', () => {
    const rows = buildGraph([
      commit('merge', ['main', 'feature']),
      commit('main', ['base']),
      commit('feature', ['base']),
      commit('base', ['older']),
      commit('older')
    ])

    // Every lane that is occupied before a row and free after it must be
    // accounted for: either it is the commit's own lane, or it bends in.
    for (const row of rows) {
      row.lanesBefore.forEach((sha, lane) => {
        if (!sha || row.lanesAfter[lane]) return
        expect(lane === row.lane || row.incomingLanes.includes(lane)).toBe(true)
      })
    }
  })

  it('has nothing incoming on an ordinary commit', () => {
    const rows = buildGraph([commit('b', ['a']), commit('a')])

    expect(rows.every((r) => r.incomingLanes.length === 0)).toBe(true)
  })

  it('reuses a lane once the branch in it is finished', () => {
    const rows = buildGraph([
      commit('merge', ['main', 'feature']),
      commit('main', ['base']),
      commit('feature', ['base']),
      commit('base', ['older']),
      commit('older')
    ])

    // base consumes both lanes' expectations, so nothing needs lane 1 after it.
    expect(rows[3].lanesAfter).toEqual(['older'])
    expect(rows[4].lane).toBe(0)
  })

  it('starts a lane for a commit whose children are not in the page', () => {
    // A page can begin mid-history; the first row still needs a lane.
    const rows = buildGraph([commit('orphan', ['parent'])])

    expect(rows[0].lane).toBe(0)
    expect(rows[0].lanesBefore).toEqual([])
  })

  it('records what passes through a row so the lines can be drawn continuous', () => {
    const rows = buildGraph([commit('tipA', ['baseA']), commit('tipB', ['baseB'])])

    // While tipB is drawn, lane 0 is still waiting for baseA and must show a
    // line crossing the row.
    expect(rows[1].lanesBefore[0]).toBe('baseA')
    expect(rows[1].lanesAfter[0]).toBe('baseA')
  })

  it('handles an empty history', () => {
    expect(buildGraph([])).toEqual([])
  })
})

describe('laneColor', () => {
  it('cycles so neighbouring lanes differ', () => {
    expect(laneColor(0)).not.toBe(laneColor(1))
  })

  it('wraps instead of running out', () => {
    expect(laneColor(0)).toBe(laneColor(6))
  })
})
