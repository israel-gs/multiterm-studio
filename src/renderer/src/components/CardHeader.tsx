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

function isMarkdownFile(filePath?: string): boolean {
  if (!filePath) return false
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'md' || ext === 'mdx'
}

function EyeIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 3C4.5 3 1.7 5.1 1 8c.7 2.9 3.5 5 7 5s6.3-2.1 7-5c-.7-2.9-3.5-5-7-5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" fill="none" />
    </svg>
  )
}

function CodeIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CardHeader({ sessionId, onClose }: Props): React.JSX.Element {
  const panel =
    usePanelStore((s) => s.panels[sessionId]) ?? {
      title: 'Terminal',
      color: colors.bgCard,
      attention: false,
      type: 'terminal' as const,
      dirty: false,
      previewMode: false,
      agentActive: false
    }
  const togglePreview = usePanelStore((s) => s.togglePreview)

  const fgColor = isLightColor(panel.color) ? '#000000' : '#ffffff'
  const isEditor = panel.type === 'editor'
  const isMd = isMarkdownFile(panel.filePath)

  return (
    <div className="panel-header" style={{ background: panel.color }}>
      {panel.attention && (
        <span className="attention-badge-inline" role="status" aria-label="Attention needed" />
      )}

      {panel.agentActive && (
        <span
          className="agent-active-dot"
          role="status"
          aria-label="Claude agent active"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#c678dd',
            flexShrink: 0,
            boxShadow: '0 0 6px #c678dd88',
            animation: 'pulse-agent 2s ease-in-out infinite'
          }}
        />
      )}

      {isEditor && panel.dirty && (
        <span className="editor-dirty-dot" role="status" aria-label="Unsaved changes" />
      )}

      <span className="panel-header-title" style={{ color: fgColor }}>
        {panel.title}
      </span>

      {isEditor && (
        <span className="editor-status-badge" style={{ color: fgColor }}>
          {panel.dirty ? 'Modified' : 'Saved'}
        </span>
      )}

      {isEditor && isMd && (
        <button
          className="panel-header-btn panel-header-preview-btn"
          style={{ color: fgColor }}
          title={panel.previewMode ? 'Show editor' : 'Preview markdown'}
          onClick={(e) => {
            e.stopPropagation()
            togglePreview(sessionId)
          }}
          aria-label={panel.previewMode ? 'Show editor' : 'Preview markdown'}
        >
          {panel.previewMode ? <CodeIcon /> : <EyeIcon />}
        </button>
      )}

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
