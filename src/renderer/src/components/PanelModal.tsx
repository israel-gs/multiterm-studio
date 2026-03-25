import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePanelStore } from '../store/panelStore'
import { PANEL_COLORS } from '../tokens'
import { Check } from 'lucide-react'

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
  const [selectedColor, setSelectedColor] = useState<string | null>(null)

  useEffect(() => {
    if (type === 'rename') inputRef.current?.focus()
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [type, onDismiss])

  if (!panel) return null

  const activeColor = selectedColor ?? panel.color

  function handleSave(): void {
    if (inputRef.current) setTitle(cardId, inputRef.current.value)
    onDismiss()
  }

  function handleColorSelect(hex: string): void {
    setSelectedColor(hex)
    setColor(cardId, hex)
  }

  return createPortal(
    <div className="panel-modal-backdrop" onMouseDown={onDismiss}>
      <div
        className="panel-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="panel-modal-header">
          <span className="panel-modal-title">
            {type === 'rename' ? 'Rename' : 'Color'}
          </span>
          <button className="panel-modal-close" onClick={onDismiss} aria-label="Close">
            &times;
          </button>
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
          <>
            {/* Live preview strip */}
            <div className="panel-modal-color-preview" style={{ background: activeColor }} />

            {/* Color grid */}
            <div className="panel-modal-colors">
              {PANEL_COLORS.map(({ hex, label }) => {
                const isActive = hex === activeColor
                return (
                  <button
                    key={hex}
                    className={`panel-modal-color-option${isActive ? ' panel-modal-color-option--selected' : ''}`}
                    onClick={() => handleColorSelect(hex)}
                    aria-label={`Set color to ${label}`}
                    title={label}
                  >
                    <span className="panel-modal-color-swatch" style={{ background: hex }} />
                    {isActive && (
                      <span className="panel-modal-color-check">
                        <Check size={12} strokeWidth={2.5} />
                      </span>
                    )}
                    <span className="panel-modal-color-label">{label}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
