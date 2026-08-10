import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useGoalStore } from '../store/goalStore'
import { usePanelStore } from '../store/panelStore'
import { formatGoalInput, MAX_GOAL_LENGTH } from '../../../shared/goals'

interface Props {
  /** The tile whose goal is edited, or null for the project-wide goal. */
  cardId: string | null
  onDismiss: () => void
}

type Scope = 'tile' | 'project'

/**
 * Editor for the objective injected into the agent running in this tile.
 *
 * The scope toggle is the point of the dialog: a tile goal overrides the
 * project one, so the user has to see which of the two they are writing.
 */
export function GoalModal({ cardId, onDismiss }: Props): React.JSX.Element {
  const goals = useGoalStore((s) => s.goals)
  const setGoal = useGoalStore((s) => s.setGoal)
  const title = usePanelStore((s) => (cardId ? s.panels[cardId]?.title : null)) ?? 'This tile'

  const [scope, setScope] = useState<Scope>(cardId ? 'tile' : 'project')
  const stored = scope === 'tile' && cardId ? (goals.tiles[cardId] ?? null) : goals.project
  // One draft per scope: switching the toggle swaps what is in the field, and
  // an unsaved edit must survive the round trip rather than be overwritten.
  const [drafts, setDrafts] = useState<Partial<Record<Scope, string>>>({})
  const text = drafts[scope] ?? formatGoalInput(stored)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // Focus once on open; the scope toggle keeps focus where the user put it.
  }, [onDismiss])

  const targetId = scope === 'tile' ? cardId : null
  const inheritsProject = scope === 'tile' && cardId && !goals.tiles[cardId] && !!goals.project

  async function handleSave(): Promise<void> {
    await setGoal(targetId, text)
    onDismiss()
  }

  async function handleClear(): Promise<void> {
    await setGoal(targetId, '')
    onDismiss()
  }

  return createPortal(
    <div className="panel-modal-backdrop" onMouseDown={onDismiss}>
      <div className="panel-modal goal-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-modal-header">
          <span className="panel-modal-title">Session goal</span>
          <button className="panel-modal-close" onClick={onDismiss} aria-label="Close">
            &times;
          </button>
        </div>

        {cardId && (
          <div className="goal-modal-scope" role="group" aria-label="Goal scope">
            <button
              className={`goal-modal-scope-btn${scope === 'tile' ? ' goal-modal-scope-btn--active' : ''}`}
              onClick={() => setScope('tile')}
              aria-pressed={scope === 'tile'}
            >
              {title}
            </button>
            <button
              className={`goal-modal-scope-btn${scope === 'project' ? ' goal-modal-scope-btn--active' : ''}`}
              onClick={() => setScope('project')}
              aria-pressed={scope === 'project'}
            >
              Whole project
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="goal-modal-textarea"
          value={text}
          maxLength={MAX_GOAL_LENGTH}
          rows={5}
          placeholder={
            'What should the agent be working towards?\n- a line starting with a dash\n- becomes a checklist step'
          }
          aria-label={scope === 'tile' ? 'Goal for this tile' : 'Goal for the whole project'}
          onChange={(e) => setDrafts((prev) => ({ ...prev, [scope]: e.target.value }))}
          onKeyDown={(e) => {
            // Enter inserts a newline — a checklist needs them.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSave()
          }}
        />

        <p className="goal-modal-hint">
          {inheritsProject
            ? 'This tile has no goal of its own, so it uses the project goal.'
            : 'Claude re-reads this every turn, and can tick steps or propose changes — you approve.'}
        </p>

        <div className="panel-modal-actions">
          {stored && (
            <button
              className="panel-modal-btn panel-modal-btn--secondary"
              onClick={() => void handleClear()}
            >
              Clear
            </button>
          )}
          <button className="panel-modal-btn panel-modal-btn--secondary" onClick={onDismiss}>
            Cancel
          </button>
          <button
            className="panel-modal-btn panel-modal-btn--primary"
            onClick={() => void handleSave()}
          >
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
