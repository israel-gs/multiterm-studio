import { useState, useEffect, useRef, useCallback } from 'react'

interface TmuxPane {
  index: number
  command: string
  active: boolean
  pid: number
}

interface Props {
  sessionId: string
}

const AGENT_COMMANDS = new Set(['claude', 'node', 'bun', 'npx'])
const POLL_INTERVAL = 2000

function isAgentPane(command: string): boolean {
  return AGENT_COMMANDS.has(command.toLowerCase())
}

function ShellIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M4.5 5.5L7 8L4.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8.5" y1="10.5" x2="11.5" y2="10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function AgentIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5L9.3 5.2L13 5.5L10.2 8L11 11.8L8 9.8L5 11.8L5.8 8L3 5.5L6.7 5.2L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  )
}

export function TmuxPaneSidebar({ sessionId }: Props): React.JSX.Element | null {
  const [panes, setPanes] = useState<TmuxPane[]>([])
  const [hovered, setHovered] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
      // Optimistic update
      setPanes((prev) =>
        prev.map((p) => ({ ...p, active: p.index === paneIndex }))
      )
    },
    [sessionId]
  )

  // Don't show sidebar if only 1 pane
  if (panes.length <= 1) return null

  return (
    <div
      className={`tmux-sidebar${hovered ? ' tmux-sidebar--expanded' : ''}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="tmux-sidebar-track">
        {panes.map((pane) => {
          const agent = isAgentPane(pane.command)
          return (
            <button
              key={pane.index}
              className={`tmux-pane-tab${pane.active ? ' tmux-pane-tab--active' : ''}${agent ? ' tmux-pane-tab--agent' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                handleSelect(pane.index)
              }}
              onMouseDown={(e) => e.stopPropagation()}
              title={`${pane.command} (pane ${pane.index})`}
            >
              <span className="tmux-pane-tab-icon">
                {agent ? <AgentIcon /> : <ShellIcon />}
              </span>
              <span className="tmux-pane-tab-label">
                <span className="tmux-pane-tab-cmd">{pane.command}</span>
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
