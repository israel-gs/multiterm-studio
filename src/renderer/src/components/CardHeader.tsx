import { useState, useRef, useEffect } from 'react'
import { usePanelStore } from '../store/panelStore'

const PRESET_COLORS = ['#569cd6', '#6a9955', '#f44747', '#d7ba7d', '#c678dd', '#4ec9b0']

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
      color: '#569cd6',
      attention: false
    }
  const setTitle = usePanelStore((s) => s.setTitle)
  const setColor = usePanelStore((s) => s.setColor)

  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 })
  const menuRef = useRef<HTMLDivElement>(null)

  const fgColor = isLightColor(panel.color) ? '#000000' : '#ffffff'

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
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
          <span className="attention-badge-inline" aria-label="Attention needed" />
        )}

        {/* Title or input */}
        {editing ? (
          <input
            className="panel-header-input"
            style={{ color: fgColor, borderBottomColor: fgColor }}
            autoFocus
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
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          {PRESET_COLORS.map((hex) => (
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
