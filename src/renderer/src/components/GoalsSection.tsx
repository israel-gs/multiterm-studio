import { useState } from 'react'
import { Check, RotateCcw, Target, Trash2, X } from 'lucide-react'
import { useGoalStore } from '../store/goalStore'
import { usePanelStore } from '../store/panelStore'
import { goalHeadline, stepProgress, type Goal, type GoalProposal } from '../../../shared/goals'
import { GoalModal } from './GoalModal'

/** "hace 4 min" in the terse form a sidebar can afford. */
function age(timestamp: number): string {
  if (!timestamp) return ''
  const minutes = Math.floor((Date.now() - timestamp) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

interface RowProps {
  /** null for the project-wide goal. */
  tileId: string | null
  title: string
  goal: Goal
  onEdit: () => void
}

/** A proposed change, shaped like a goal so it can be rendered as one. */
function proposedGoal(proposal: GoalProposal): Goal {
  return {
    text: proposal.text ?? '',
    steps: proposal.steps ?? [],
    status: 'active',
    updatedAt: proposal.at
  }
}

function GoalRow({ tileId, title, goal, onEdit }: RowProps): React.JSX.Element {
  const setStepDone = useGoalStore((s) => s.setStepDone)
  const complete = useGoalStore((s) => s.complete)
  const reopen = useGoalStore((s) => s.reopen)
  const setGoal = useGoalStore((s) => s.setGoal)
  const approve = useGoalStore((s) => s.approve)
  const reject = useGoalStore((s) => s.reject)
  const progress = stepProgress(goal)
  const isDone = goal.status === 'done'
  const allStepsDone = !!progress && progress.done === progress.total

  return (
    <div
      className={`goal-row${isDone ? ' goal-row--done' : ''}${goal.proposal ? ' goal-row--pending' : ''}`}
    >
      <div className="goal-row-head">
        <button
          className="goal-row-title"
          onClick={() => {
            // Finding the terminal a goal belongs to is half of what this panel
            // is for, so the click reveals the tile as well as opening the goal.
            if (tileId) usePanelStore.getState().revealTile(tileId)
            onEdit()
          }}
          title="Edit this goal"
        >
          {title}
        </button>
        <span className="goal-row-age">{age(goal.completedAt ?? goal.updatedAt)}</span>
      </div>

      {goal.text && <p className="goal-row-text">{goal.text}</p>}

      {progress && (
        <div className="goal-row-steps">
          {goal.steps.map((step, i) => (
            <label key={`${step.text}-${i}`} className="goal-step">
              <input
                type="checkbox"
                checked={step.done}
                disabled={isDone}
                onChange={(e) => void setStepDone(tileId, i, e.target.checked)}
              />
              <span
                className={step.done ? 'goal-step-text goal-step-text--done' : 'goal-step-text'}
              >
                {step.text}
              </span>
            </label>
          ))}
        </div>
      )}

      {goal.proposal && (
        <div className="goal-proposal">
          <span className="goal-proposal-label">
            {goal.proposal.kind === 'complete'
              ? 'Claude says this is done'
              : 'Claude asks to change this'}
          </span>
          {goal.proposal.kind === 'complete' ? (
            goal.proposal.summary && <p className="goal-proposal-body">{goal.proposal.summary}</p>
          ) : (
            <>
              <p className="goal-proposal-body">{goalHeadline(proposedGoal(goal.proposal))}</p>
              {goal.proposal.reason && (
                <p className="goal-proposal-reason">{goal.proposal.reason}</p>
              )}
            </>
          )}
          <div className="goal-proposal-actions">
            <button
              className="goal-row-btn goal-row-btn--approve"
              onClick={() => void approve(tileId)}
            >
              <Check size={11} strokeWidth={2} /> Accept
            </button>
            <button className="goal-row-btn" onClick={() => void reject(tileId)}>
              <X size={11} strokeWidth={2} /> Reject
            </button>
          </div>
        </div>
      )}

      {goal.claim && (
        <p className="goal-row-claim" title="What the agent reported when it closed this">
          {goal.claim}
        </p>
      )}

      {allStepsDone && !isDone && !goal.proposal && (
        // Every step ticked is not the same as the goal being met, and the two
        // look identical once the checklist is struck through. Only the user
        // closes a goal, so the row has to say it is still open.
        <p className="goal-row-open-note">All steps ticked — still open until you close it.</p>
      )}

      <div className="goal-row-actions">
        {progress && (
          <span className="goal-row-progress">{`${progress.done}/${progress.total}`}</span>
        )}
        {isDone ? (
          <button
            className="goal-row-btn"
            onClick={() => void reopen(tileId)}
            title="Reopen this goal"
          >
            <RotateCcw size={11} strokeWidth={1.5} /> Reopen
          </button>
        ) : (
          <button
            className={`goal-row-btn${allStepsDone ? ' goal-row-btn--approve' : ''}`}
            onClick={() => void complete(tileId, '')}
            title="Close this goal"
          >
            <Check size={11} strokeWidth={2} /> Close
          </button>
        )}
        <button
          className="goal-row-btn goal-row-btn--danger"
          onClick={() => void setGoal(tileId, '')}
          title="Remove this goal"
          aria-label="Remove this goal"
        >
          <Trash2 size={11} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  )
}

/**
 * Every goal in the project at a glance: the project-wide one, the tiles that
 * have their own, and what has already been met.
 */
export function GoalsSection(): React.JSX.Element {
  const goals = useGoalStore((s) => s.goals)
  const panels = usePanelStore((s) => s.panels)
  const [editing, setEditing] = useState<string | null>(null)

  const tileEntries = Object.entries(goals.tiles)
  const active = tileEntries.filter(([, g]) => g.status !== 'done')
  const done = tileEntries
    .filter(([, g]) => g.status === 'done')
    .sort((a, b) => (b[1].completedAt ?? 0) - (a[1].completedAt ?? 0))

  const hasAnything = goals.project || tileEntries.length > 0

  return (
    <div className="goals-section">
      {!hasAnything && (
        <p className="goals-empty">
          No goals yet. Open a terminal&apos;s <Target size={11} strokeWidth={1.5} /> to say what it
          should be working towards.
        </p>
      )}

      {goals.project && (
        <>
          <h3 className="goals-heading">Project</h3>
          <GoalRow
            tileId={null}
            title="Whole project"
            goal={goals.project}
            onEdit={() => setEditing('__project__')}
          />
        </>
      )}

      {active.length > 0 && <h3 className="goals-heading">Terminals</h3>}
      {active.map(([tileId, goal]) => (
        <GoalRow
          key={tileId}
          tileId={tileId}
          title={panels[tileId]?.title ?? 'Closed tile'}
          goal={goal}
          onEdit={() => setEditing(tileId)}
        />
      ))}

      {done.length > 0 && <h3 className="goals-heading">Completed</h3>}
      {done.map(([tileId, goal]) => (
        <GoalRow
          key={tileId}
          tileId={tileId}
          title={panels[tileId]?.title ?? 'Closed tile'}
          goal={goal}
          onEdit={() => setEditing(tileId)}
        />
      ))}

      {editing && (
        <GoalModal
          cardId={editing === '__project__' ? null : editing}
          onDismiss={() => setEditing(null)}
        />
      )}
    </div>
  )
}
