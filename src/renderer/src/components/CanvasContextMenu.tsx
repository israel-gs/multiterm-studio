import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface CanvasContextMenuProps {
  x: number
  y: number
  type: 'canvas' | 'card'
  cardId?: string
  onNewTerminal: () => void
  onCloseTerminal?: (id: string) => void
  onDismiss: () => void
}

export function CanvasContextMenu({
  x,
  y,
  type,
  cardId,
  onNewTerminal,
  onCloseTerminal,
  onDismiss
}: CanvasContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onDismiss()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onDismiss])

  return createPortal(
    <div ref={menuRef} className="canvas-context-menu" style={{ left: x, top: y }}>
      {type === 'canvas' && (
        <div
          className="canvas-context-menu-item"
          onClick={() => {
            onNewTerminal()
            onDismiss()
          }}
        >
          New terminal
        </div>
      )}
      {type === 'card' && cardId && (
        <div
          className="canvas-context-menu-item canvas-context-menu-item--danger"
          onClick={() => {
            onCloseTerminal?.(cardId)
            onDismiss()
          }}
        >
          Close terminal
        </div>
      )}
    </div>,
    document.body
  )
}
