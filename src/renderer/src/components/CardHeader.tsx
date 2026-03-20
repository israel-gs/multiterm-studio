import { useState, useRef, useEffect } from 'react'
import { usePanelStore } from '../store/panelStore'
import { PANEL_COLORS, colors } from '../tokens'

interface Props {
  sessionId: string
  onClose: () => void
}

/** Returns true if the color is light enough to need dark text */
function isLightColor(hex: string): boolean {
  const c = hex.replace('#', '')
  const r = parseInt(c.substring(0, 2), 16)
  const g = parseInt(c.substring(2, 4), 16)
  const b = parseInt(c.substring(4, 6), 16)
  // W3C relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

export function CardHeader({ sessionId, onClose }: Props): React.JSX.Element {
  const panel =
    usePanelStore((s) => s.panels[sessionId]) ?? {
      title: 'Terminal',
      color: colors.blue,
      attention: false
    }
  const setTitle = usePanelStore((s) => s.setTitle)
  const setColor = usePanelStore((s) => s.setColor)

  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  const fgColor = isLightColor(panel.color) ? '#000000' : '#ffffff'

  // Close menu on outside click or Escape; auto-focus first option
  useEffect(() => {
    if (!menuOpen) return
    const first = menuRef.current?.querySelector<HTMLElement>('button')
    first?.focus()
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    setMenuPos({ x: e.clientX, y: e.clientY })
    setMenuOpen(true)
  }

  return (
    <>
      <div
        className="panel-header"
        style={{ background: panel.color }}
        onContextMenu={handleContextMenu}
      >
        {/* Attention badge */}
        {panel.attention && (
          <span className="attention-badge-inline" role="status" aria-label="Attention needed" />
        )}

        {/* Title or input */}
        {editing ? (
          <input
            className="panel-header-input"
            style={{ color: fgColor, borderBottomColor: fgColor }}
            autoFocus
            aria-label="Panel title"
            defaultValue={panel.title}
            onBlur={(e) => {
              setTitle(sessionId, e.target.value)
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
          />
        ) : (
          <span
            className="panel-header-title"
            style={{ color: fgColor }}
            title="Double-click to rename"
            onDoubleClick={() => setEditing(true)}
          >
            {panel.title}
          </span>
        )}

        {/* Close button */}
        <button
          className="panel-header-btn"
          style={{ color: fgColor }}
          title="Close panel"
          onClick={onClose}
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* Color context menu */}
      {menuOpen && (
        <div
          ref={menuRef}
          className="color-context-menu"
          role="menu"
          aria-label="Panel colors"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {PANEL_COLORS.map((hex) => (
            <button
              key={hex}
              className="color-context-option"
              style={{ background: hex }}
              onClick={() => {
                setColor(sessionId, hex)
                setMenuOpen(false)
              }}
              aria-label={`Set color to ${hex}`}
            />
          ))}
        </div>
      )}
    </>
  )
}
