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
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

export function CardHeader({ sessionId, onClose }: Props): React.JSX.Element {
  const panel =
    usePanelStore((s) => s.panels[sessionId]) ?? {
      title: 'Terminal',
      color: colors.bgCard,
      attention: false
    }

  const fgColor = isLightColor(panel.color) ? '#000000' : '#ffffff'

  return (
    <div className="panel-header" style={{ background: panel.color }}>
      {panel.attention && (
        <span className="attention-badge-inline" role="status" aria-label="Attention needed" />
      )}

      <span className="panel-header-title" style={{ color: fgColor }}>
        {panel.title}
      </span>

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
