import type { GitCommit } from '../../../shared/git'

/**
 * One row of the commit graph: where the dot goes and which lines cross it.
 *
 * Lanes are columns. A commit sits in the lane its child reserved for it, so a
 * run of commits on one branch stays in a straight line, and a merge is the
 * only place a line moves sideways.
 */
export interface GraphRow {
  sha: string
  /** Column this commit's dot sits in. */
  lane: number
  /** Lanes occupied above this row, by the commit each one is waiting for. */
  lanesBefore: (string | null)[]
  /** Lanes occupied below it, after this commit handed over to its parents. */
  lanesAfter: (string | null)[]
  /** Lane each parent continues in, drawn as a line leaving the dot. */
  parentLanes: number[]
  /**
   * Other lanes that were waiting for this same commit — one per branch that
   * ends here. They are drawn curving into the dot; without them a merged
   * branch's line stopped dead in the middle of the row.
   */
  incomingLanes: number[]
  /** How many lanes the row needs, for sizing the gutter. */
  width: number
}

/**
 * Assign a lane to every commit.
 *
 * Expects the commits in topological order, which is what `git log
 * --topo-order` gives: a commit is always listed before its parents, so by the
 * time a parent is reached some child has already reserved its lane.
 */
export function buildGraph(commits: GitCommit[]): GraphRow[] {
  // lanes[i] holds the sha the column is waiting to draw, or null when free.
  const lanes: (string | null)[] = []
  const rows: GraphRow[] = []

  for (const commit of commits) {
    const lanesBefore = [...lanes]

    // A commit whose children are all outside the loaded page has nobody
    // holding a lane for it, so it starts a new one.
    let lane = lanes.indexOf(commit.sha)
    if (lane === -1) lane = claimLane(lanes, commit.sha)

    // Several children can each have reserved a lane for this same commit — one
    // per branch that reaches it. Only the lane it is drawn in stays; the others
    // end here, and the renderer bends them into the dot.
    const incomingLanes: number[] = []
    for (let other = 0; other < lanes.length; other++) {
      if (other !== lane && lanes[other] === commit.sha) {
        incomingLanes.push(other)
        lanes[other] = null
      }
    }

    // Hand the lane to the first parent: that is what keeps a branch straight.
    lanes[lane] = commit.parents[0] ?? null
    const parentLanes = commit.parents.length > 0 ? [lane] : []

    // Remaining parents of a merge either already have a lane, or take a new
    // one; either way the line leaves this dot sideways.
    for (const parent of commit.parents.slice(1)) {
      const existing = lanes.indexOf(parent)
      parentLanes.push(existing === -1 ? claimLane(lanes, parent) : existing)
    }

    // A lane whose commit was just consumed and is not waited on again is done.
    trimTrailingFree(lanes)

    rows.push({
      sha: commit.sha,
      lane,
      lanesBefore,
      lanesAfter: [...lanes],
      parentLanes,
      incomingLanes,
      width: Math.max(lanesBefore.length, lanes.length, lane + 1)
    })
  }

  return rows
}

/** Put `sha` in the leftmost free lane, adding a column only if none is free. */
function claimLane(lanes: (string | null)[], sha: string): number {
  const free = lanes.indexOf(null)
  if (free !== -1) {
    lanes[free] = sha
    return free
  }
  lanes.push(sha)
  return lanes.length - 1
}

function trimTrailingFree(lanes: (string | null)[]): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
}

/** Lane colours cycle, so neighbouring branches stay tellable apart. */
const LANE_COLORS = [
  'var(--color-blue)',
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-yellow)',
  'var(--color-cyan)',
  'var(--color-red)'
]

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}
