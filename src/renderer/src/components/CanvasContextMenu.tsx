import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface CanvasContextMenuProps {
  x: number
  y: number
  type: 'canvas' | 'card'
  cardId?: string
  cardType?: 'terminal' | 'editor'
  onNewTerminal: () => void
  onRenameTerminal?: (id: string) => void
  onChangeColor?: (id: string) => void
  onCloseTerminal?: (id: string) => void
  onDismiss: () => void
}

export function CanvasContextMenu({
  x,
  y,
  type,
  cardId,
  cardType,
  onNewTerminal,
  onRenameTerminal,
  onChangeColor,
  onCloseTerminal,
  onDismiss
}: CanvasContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
              onRenameTerminal?.(cardId)
              onDismiss()
            }}
          >
            Rename
          </button>
          <button
            className="canvas-context-menu-item"
            role="menuitem"
            onClick={() => {
              onChangeColor?.(cardId)
              onDismiss()
            }}
          >
            Change color
          </button>
          <div className="canvas-context-menu-divider" />
          <button
            className="canvas-context-menu-item canvas-context-menu-item--danger"
            role="menuitem"
            onClick={() => {
              onCloseTerminal?.(cardId)
              onDismiss()
            }}
          >
            {cardType === 'editor' ? 'Close editor' : 'Close terminal'}
          </button>
        </>
      )}
    </div>,
    document.body
  )
}
