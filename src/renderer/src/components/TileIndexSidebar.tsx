import { useEffect, useMemo, useRef } from 'react'
import { EyeOff, Maximize2, PanelRight } from 'lucide-react'
import { usePanelStore, type PanelMeta } from '../store/panelStore'
import { useCanvasStore } from '../store/canvasStore'
import { shortenHome } from '../utils/path'

/** Status shown as the leading dot, most urgent first. */
type TileState = 'attention' | 'agent' | 'running' | 'dirty' | 'idle'

function tileState(panel: PanelMeta): TileState {
  if (panel.attention) return 'attention'
  if (panel.agentActive) return 'agent'
  if (panel.hasProcess) return 'running'
  if (panel.dirty) return 'dirty'
  return 'idle'
}

const STATE_TITLES: Record<TileState, string> = {
  attention: 'Waiting for you',
  agent: 'Claude agent active',
  running: 'Process running',
  dirty: 'Unsaved changes',
  idle: 'Idle'
}

/**
 * The word after the tile name: what the terminal is busy with, or the state of
 * an editor. The reference for this pane shows the shell plus the foreground
 * process; the equivalent here is the tile's own name plus what it is running,
 * because a tile started from a preset is already named after its command.
 */
function tileDetail(panel: PanelMeta): string {
  if (panel.type === 'terminal') return panel.processName ?? 'idle'
  if (panel.type === 'editor') return panel.dirty ? 'modified' : 'saved'
  if (panel.type === 'diff') return panel.diffStaged ? 'staged' : 'working tree'
  return ''
}

/** The dimmed second line: where the tile is pointed. */
function tileSubtitle(panel: PanelMeta): string {
  if (panel.filePath) return shortenHome(panel.filePath)
  if (panel.cwd) return shortenHome(panel.cwd)
  return ''
}

const GROUPS: { type: PanelMeta['type']; title: string }[] = [
  { type: 'terminal', title: 'Terminals' },
  { type: 'diff', title: 'Diffs' },
  { type: 'editor', title: 'Editors' },
  { type: 'note', title: 'Notes' },
  { type: 'image', title: 'Images' }
]

interface TileIndexSidebarProps {
  onToggle?: () => void
}

export function TileIndexSidebar({ onToggle }: TileIndexSidebarProps): React.JSX.Element {
  const panels = usePanelStore((s) => s.panels)
  const revealTile = usePanelStore((s) => s.revealTile)
  const tileOrder = useCanvasStore((s) => s.tileOrder)
  const focusedId = useCanvasStore((s) => s.focusedId)
  const maximizedId = useCanvasStore((s) => s.maximizedId)
  const offscreenIds = useCanvasStore((s) => s.offscreenIds)

  const grouped = useMemo(
    () =>
      GROUPS.map(({ type, title }) => ({
        title,
        ids: tileOrder.filter((id) => panels[id]?.type === type)
      })).filter((group) => group.ids.length > 0),
    [tileOrder, panels]
  )

  return (
    <aside className="tile-index">
      <div className="tile-index-header">
        <span className="tile-index-header-title">Tiles</span>
        {onToggle && (
          <button
            className="sidebar-toggle-btn"
            onClick={onToggle}
            aria-label="Hide tile index"
            title="Hide tile index"
          >
            <PanelRight size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="tile-index-body">
        {grouped.length === 0 && <p className="tile-index-empty">No tiles open</p>}

        {grouped.map((group) => (
          <section className="tile-index-group" key={group.title}>
            <div className="tile-index-group-label">
              {group.title}
              <span className="tile-index-group-count">{group.ids.length}</span>
            </div>
            <ul>
              {group.ids.map((id) => (
                <TileIndexRow
                  key={id}
                  panel={panels[id]}
                  focused={focusedId === id}
                  maximized={maximizedId === id}
                  offscreen={offscreenIds.has(id)}
                  onReveal={(maximize) => revealTile(id, maximize)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </aside>
  )
}

function TileIndexRow({
  panel,
  focused,
  maximized,
  offscreen,
  onReveal
}: {
  panel: PanelMeta
  focused: boolean
  maximized: boolean
  offscreen: boolean
  onReveal: (maximize: boolean) => void
}): React.JSX.Element {
  const rowRef = useRef<HTMLButtonElement>(null)
  const state = tileState(panel)
  const detail = tileDetail(panel)
  const subtitle = tileSubtitle(panel)

  // Focus moves on the canvas too — with spatial navigation, or by clicking a
  // tile — so the index follows rather than only leading.
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  const className = [
    'tile-index-row',
    focused && 'tile-index-row--focused',
    offscreen && 'tile-index-row--offscreen'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <li>
      <button
        ref={rowRef}
        className={className}
        onClick={() => onReveal(false)}
        onDoubleClick={() => onReveal(true)}
        title={offscreen ? `${panel.title} — off screen, click to pan to it` : panel.title}
      >
        <span
          className={`tile-index-dot tile-index-dot--${state}`}
          aria-label={STATE_TITLES[state]}
          title={STATE_TITLES[state]}
        />
        <span className="tile-index-text">
          <span className="tile-index-title-row">
            <span className="tile-index-title">{panel.title}</span>
            {detail && <span className="tile-index-detail">{detail}</span>}
            {maximized && (
              <Maximize2 className="tile-index-flag" size={10} strokeWidth={2} aria-hidden="true" />
            )}
            {offscreen && (
              <EyeOff className="tile-index-flag" size={10} strokeWidth={2} aria-hidden="true" />
            )}
          </span>
          {subtitle && <span className="tile-index-subtitle">{subtitle}</span>}
        </span>
      </button>
    </li>
  )
}
