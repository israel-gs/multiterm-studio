import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { usePanelStore } from '../store/panelStore'
import { PANEL_COLORS } from '../tokens'

interface Props {
  type: 'rename' | 'color'
  cardId: string
  onDismiss: () => void
}

export function PanelModal({ type, cardId, onDismiss }: Props): React.JSX.Element | null {
  const panel = usePanelStore((s) => s.panels[cardId])
  const setTitle = usePanelStore((s) => s.setTitle)
  const setColor = usePanelStore((s) => s.setColor)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (type === 'rename') inputRef.current?.focus()
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [type, onDismiss])

  if (!panel) return null

  function handleSave(): void {
    if (inputRef.current) setTitle(cardId, inputRef.current.value)
    onDismiss()
  }

  return createPortal(
    <div className="panel-modal-backdrop" onMouseDown={onDismiss}>
      <div className="panel-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-modal-title">
          {type === 'rename' ? 'Rename terminal' : 'Change color'}
        </div>

        {type === 'rename' && (
          <>
            <input
              ref={inputRef}
              className="panel-modal-input"
              defaultValue={panel.title}
              aria-label="Terminal name"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
            />
            <div className="panel-modal-actions">
              <button className="panel-modal-btn panel-modal-btn--secondary" onClick={onDismiss}>
                Cancel
              </button>
              <button className="panel-modal-btn panel-modal-btn--primary" onClick={handleSave}>
                Save
              </button>
            </div>
          </>
        )}

        {type === 'color' && (
          <div className="panel-modal-colors">
            {PANEL_COLORS.map((hex) => (
              <button
                key={hex}
                className={`panel-modal-color-option${hex === panel.color ? ' panel-modal-color-option--selected' : ''}`}
                style={{ background: hex }}
                onClick={() => {
                  setColor(cardId, hex)
                  onDismiss()
                }}
                aria-label={`Set color to ${hex}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
