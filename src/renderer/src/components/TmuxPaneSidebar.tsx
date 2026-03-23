import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { TerminalSquare, Sparkles } from 'lucide-react'
import { usePanelStore } from '../store/panelStore'

interface TmuxPane {
  index: number
  command: string
  title: string
  active: boolean
  pid: number
}

interface Props {
  sessionId: string
}

const POLL_INTERVAL = 2000


export function TmuxPaneSidebar({ sessionId }: Props): React.JSX.Element | null {
  const [panes, setPanes] = useState<TmuxPane[]>([])
  const [hovered, setHovered] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const allAgentNames = usePanelStore((s) => s.agentNames)
  const agentNames = useMemo(() => allAgentNames[sessionId] ?? [], [allAgentNames, sessionId])

  const poll = useCallback(async () => {
    const result = await window.electronAPI.ptyListPanes(sessionId)
    setPanes(result)
  }, [sessionId])

  useEffect(() => {
    poll()
    timerRef.current = setInterval(poll, POLL_INTERVAL)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [poll])

  const handleSelect = useCallback(
    (paneIndex: number) => {
      window.electronAPI.ptySelectPane(sessionId, paneIndex)
      setPanes((prev) =>
        prev.map((p) => ({ ...p, active: p.index === paneIndex }))
      )
    },
    [sessionId]
  )

  if (panes.length <= 1) return null

  return (
    <div
      className={`tmux-sidebar${hovered ? ' tmux-sidebar--expanded' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tmux-sidebar-track">
        {panes.map((pane, i) => {
          const isMain = i === 0
          // Pane 0 = main claude session, panes 1+ = team agents
          const name = isMain
            ? 'claude'
            : agentNames[i - 1]
              ? `@${agentNames[i - 1]}`
              : `agent ${pane.index}`
          return (
            <button
              key={pane.index}
              className={`tmux-pane-tab${pane.active ? ' tmux-pane-tab--active' : ''}${!isMain ? ' tmux-pane-tab--agent' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleSelect(pane.index)
                const card = (e.target as HTMLElement).closest('.floating-card')
                const xtermEl = card?.querySelector('.xterm-helper-textarea') as HTMLElement
                if (xtermEl) xtermEl.focus()
              }}
              title={pane.title || name}
            >
              <span className="tmux-pane-tab-icon">
                {isMain ? <TerminalSquare size={14} strokeWidth={1.5} /> : <Sparkles size={14} strokeWidth={1.5} />}
              </span>
              <span className="tmux-pane-tab-label">
                <span className="tmux-pane-tab-cmd">{name}</span>
                <span className="tmux-pane-tab-idx">#{pane.index}</span>
              </span>
              {pane.active && <span className="tmux-pane-tab-dot" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
