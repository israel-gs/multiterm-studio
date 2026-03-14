import { useState, useContext } from 'react'
import { MosaicWindowContext, MosaicContext } from 'react-mosaic-component'
import type { MosaicPath } from 'react-mosaic-component'
import { usePanelStore } from '../store/panelStore'

const PRESET_COLORS = ['#569cd6', '#6a9955', '#f44747', '#d7ba7d', '#c678dd', '#4ec9b0']

interface Props {
  sessionId: string
  path: MosaicPath
}

export function PanelHeader({ sessionId, path }: Props): React.JSX.Element {
  const { mosaicWindowActions } = useContext(MosaicWindowContext)
  const { mosaicActions } = useContext(MosaicContext)

  const panel = usePanelStore((s) => s.panels[sessionId]) ?? { title: 'Terminal', color: '#569cd6' }
  const setTitle = usePanelStore((s) => s.setTitle)
  const setColor = usePanelStore((s) => s.setColor)

  const [editing, setEditing] = useState(false)

  return (
    <div className="panel-header">
      {/* Color dot */}
      <span
        className="color-dot"
        data-testid="color-dot"
        style={{ background: panel.color }}
        title="Panel color"
      />

      {/* Color picker: 6 small preset dots */}
      {PRESET_COLORS.map((hex) => (
        <button
          key={hex}
          className="color-option"
          data-testid={`color-option-${hex}`}
          style={{ background: hex }}
          title={hex}
          onClick={() => setColor(sessionId, hex)}
          aria-label={`Set color to ${hex}`}
        />
      ))}

      {/* Title or input */}
      {editing ? (
        <input
          className="panel-header-input"
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
          onDoubleClick={() => setEditing(true)}
        >
          {panel.title}
        </span>
      )}

      {/* Spacer handled by flex: 1 on title/input */}

      {/* Split button */}
      <button
        className="panel-header-btn"
        title="Split panel"
        onClick={() => mosaicWindowActions.split()}
        aria-label="Split panel"
      >
        ⊞
      </button>

      {/* Close button */}
      <button
        className="panel-header-btn"
        title="Close panel"
        onClick={() => mosaicActions.remove(path)}
        aria-label="Close panel"
      >
        ×
      </button>
    </div>
  )
}
