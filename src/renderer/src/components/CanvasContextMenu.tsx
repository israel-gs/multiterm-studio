import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { PANEL_COLORS } from '../tokens'

interface CanvasContextMenuProps {
  x: number
  y: number
  type: 'canvas' | 'card'
  cardId?: string
  onNewTerminal: () => void
  onCloseTerminal?: (id: string) => void
  onChangeColor?: (id: string, color: string) => void
  onDismiss: () => void
}

export function CanvasContextMenu({
  x,
  y,
  type,
  cardId,
  onNewTerminal,
  onCloseTerminal,
  onChangeColor,
  onDismiss
}: CanvasContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-focus first menu item on open
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()

    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onDismiss])

  return createPortal(
    <div
      ref={menuRef}
      className="canvas-context-menu"
      role="menu"
      style={{ left: x, top: y }}
    >
      {type === 'canvas' && (
        <button
          className="canvas-context-menu-item"
          role="menuitem"
          onClick={() => {
            onNewTerminal()
            onDismiss()
          }}
        >
          New terminal
        </button>
      )}
      {type === 'card' && cardId && (
        <>
          <button
            className="canvas-context-menu-item"
            role="menuitem"
            onClick={() => {
              document.dispatchEvent(
                new CustomEvent('panel:rename', { detail: { id: cardId } })
              )
              onDismiss()
            }}
          >
            Rename
          </button>
          <div className="canvas-context-menu-divider" />
          <div className="canvas-context-menu-colors">
            {PANEL_COLORS.map((hex) => (
              <button
                key={hex}
                className="color-context-option"
                style={{ background: hex }}
                onClick={() => {
                  onChangeColor?.(cardId, hex)
                  onDismiss()
                }}
                aria-label={`Set color to ${hex}`}
              />
            ))}
          </div>
          <div className="canvas-context-menu-divider" />
          <button
            className="canvas-context-menu-item canvas-context-menu-item--danger"
            role="menuitem"
            onClick={() => {
              onCloseTerminal?.(cardId)
              onDismiss()
            }}
          >
            Close terminal
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
