import { useState, useCallback } from 'react'
import { Eye, Code, Maximize2, Minimize2, X, Zap, Copy, Check } from 'lucide-react'
import { usePanelStore } from '../store/panelStore'
import { colors } from '../tokens'

interface Props {
  sessionId: string
  maximized?: boolean
  onToggleMaximize?: () => void
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

function isSvgFile(filePath?: string): boolean {
  if (!filePath) return false
  return filePath.split('.').pop()?.toLowerCase() === 'svg'
}

export function CardHeader({ sessionId, maximized, onToggleMaximize, onClose }: Props): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const handleCopyPath = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const fp = usePanelStore.getState().panels[sessionId]?.filePath
    if (!fp) return
    navigator.clipboard.writeText(fp)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [sessionId])

  const panel =
    usePanelStore((s) => s.panels[sessionId]) ?? {
      title: 'Terminal',
      color: colors.bgCard,
      attention: false,
      type: 'terminal' as const,
      dirty: false,
      previewMode: false,
      agentActive: false,
      hasProcess: false
    }
  const togglePreview = usePanelStore((s) => s.togglePreview)

  const isDefaultColor = panel.color === colors.bgCard || panel.color === '#1c1c1c'
  const headerBg = isDefaultColor ? undefined : panel.color
  const fgColor = isDefaultColor ? 'var(--fg-primary)' : (isLightColor(panel.color) ? '#000000' : '#ffffff')
  const isEditor = panel.type === 'editor'
  const isImage = panel.type === 'image'
  const isMd = isMarkdownFile(panel.filePath)
  const isSvg = isSvgFile(panel.filePath)

  return (
    <div className="panel-header" style={headerBg ? { background: headerBg } : undefined}>
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

      {panel.hasProcess && (
        <span title={panel.processName ? `Running: ${panel.processName}` : 'Process running'}>
          <Zap size={12} strokeWidth={1.5} style={{ color: '#e5a84b', flexShrink: 0 }} />
        </span>
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
          {panel.previewMode ? <Code size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
        </button>
      )}

      {isImage && isSvg && (
        <button
          className="panel-header-btn panel-header-preview-btn"
          style={{ color: fgColor }}
          title={panel.previewMode ? 'Show image' : 'Edit SVG code'}
          onClick={(e) => {
            e.stopPropagation()
            togglePreview(sessionId)
          }}
          aria-label={panel.previewMode ? 'Show image' : 'Edit SVG code'}
        >
          {panel.previewMode ? <Eye size={14} strokeWidth={1.5} /> : <Code size={14} strokeWidth={1.5} />}
        </button>
      )}

      {(isEditor || isImage) && panel.filePath && (
        <button
          className="panel-header-btn"
          style={{ color: fgColor }}
          title={copied ? 'Copied!' : 'Copy path'}
          onClick={handleCopyPath}
          aria-label="Copy file path"
        >
          {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.5} />}
        </button>
      )}

      {onToggleMaximize && (
        <button
          className="panel-header-btn"
          style={{ color: fgColor }}
          title={maximized ? 'Restore' : 'Maximize'}
          onClick={(e) => { e.stopPropagation(); onToggleMaximize() }}
          aria-label={maximized ? 'Restore tile' : 'Maximize tile'}
        >
          {maximized ? <Minimize2 size={12} strokeWidth={1.5} /> : <Maximize2 size={12} strokeWidth={1.5} />}
        </button>
      )}

      <button
        className="panel-header-btn"
        style={{ color: fgColor }}
        title="Close panel"
        onClick={onClose}
        aria-label="Close panel"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </div>
  )
}
