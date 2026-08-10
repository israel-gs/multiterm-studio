import { create } from 'zustand'
import type { Goal, GoalFile } from '../../../shared/goals'
import { effectiveGoal } from '../../../shared/goals'

const EMPTY: GoalFile = { project: null, tiles: {} }

interface GoalStore {
  /** The project the loaded goals belong to; null before the first load. */
  folderPath: string | null
  goals: GoalFile
  load: (folderPath: string) => Promise<void>
  /** Re-reads from disk, for writes that came from the agent's MCP tools. */
  refresh: () => Promise<void>
  /** Sets a tile's goal, or the project's when `tileId` is null. */
  setGoal: (tileId: string | null, text: string) => Promise<void>
  complete: (tileId: string | null, claim: string) => Promise<void>
  reopen: (tileId: string | null) => Promise<void>
  setStepDone: (tileId: string | null, index: number, done: boolean) => Promise<void>
  /** Accepts what the agent proposed — the only path that closes a goal. */
  approve: (tileId: string | null) => Promise<void>
  reject: (tileId: string | null) => Promise<void>
}

export const useGoalStore = create<GoalStore>((set, get) => ({
  folderPath: null,
  goals: EMPTY,

  load: async (folderPath) => {
    const goals = await window.electronAPI.goalsLoad(folderPath)
    set({ goals, folderPath })
  },

  refresh: async () => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalsLoad(folderPath) })
  },

  setGoal: async (tileId, text) => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalSet(folderPath, tileId, text) })
  },

  complete: async (tileId, claim) => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalComplete(folderPath, tileId, claim) })
  },

  reopen: async (tileId) => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalReopen(folderPath, tileId) })
  },

  setStepDone: async (tileId, index, done) => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalStep(folderPath, tileId, index, done) })
  },

  approve: async (tileId) => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalApprove(folderPath, tileId) })
  },

  reject: async (tileId) => {
    const { folderPath } = get()
    if (!folderPath) return
    set({ goals: await window.electronAPI.goalReject(folderPath, tileId) })
  }
}))

/** How many proposals are waiting on the user right now. */
export function usePendingProposalCount(): number {
  return useGoalStore((s) => {
    let count = s.goals.project?.proposal ? 1 : 0
    for (const goal of Object.values(s.goals.tiles)) if (goal.proposal) count++
    return count
  })
}

/** Reads the goal that applies to a tile — its own, or the project's. */
export function useEffectiveGoal(tileId: string | null): Goal | null {
  return useGoalStore((s) => effectiveGoal(s.goals, tileId))
}
