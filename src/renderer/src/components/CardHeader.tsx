import { useState, useEffect } from 'react'
import { usePanelStore } from '../store/panelStore'
import { colors } from '../tokens'

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

  const [editing, setEditing] = useState(false)

  const fgColor = isLightColor(panel.color) ? '#000000' : '#ffffff'

  // Listen for rename request from context menu
  useEffect(() => {
    function onRename(e: Event): void {
      if ((e as CustomEvent).detail?.id === sessionId) setEditing(true)
    }
    document.addEventListener('panel:rename', onRename)
    return () => document.removeEventListener('panel:rename', onRename)
  }, [sessionId])

  return (
    <div
      className="panel-header"
      style={{ background: panel.color }}
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
  )
}
