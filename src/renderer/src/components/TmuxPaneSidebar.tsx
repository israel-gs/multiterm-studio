import { useState, useEffect, useRef, useCallback } from 'react'

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

const SHELL_COMMANDS = new Set(['zsh', 'bash', 'sh', 'fish'])
const POLL_INTERVAL = 2000

/** Detect agent panes by the ✳ prefix in the title set by Claude Code */
function isAgentPane(pane: TmuxPane): boolean {
  if (pane.title.startsWith('✳')) return true
  return !SHELL_COMMANDS.has(pane.command.toLowerCase())
}

/** Extract a short display name from the pane title or command */
function getDisplayName(pane: TmuxPane): string {
  // Claude Code agent titles look like: "✳ Review VS Code extension code quality"
  if (pane.title.startsWith('✳')) {
    const text = pane.title.slice(1).trim()
    // Truncate to first ~30 chars for the tab
    return text.length > 30 ? text.slice(0, 28) + '…' : text
  }
  // Shell panes: show the shell name
  if (SHELL_COMMANDS.has(pane.command.toLowerCase())) {
    return pane.command
  }
  // Fallback: use title if it's more descriptive than the command
  if (pane.title && pane.title !== pane.command && !pane.title.includes('.local')) {
    const text = pane.title
    return text.length > 30 ? text.slice(0, 28) + '…' : text
  }
  return pane.command
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
        {panes.map((pane) => {
          const agent = isAgentPane(pane)
          const displayName = getDisplayName(pane)
          return (
            <button
              key={pane.index}
              className={`tmux-pane-tab${pane.active ? ' tmux-pane-tab--active' : ''}${agent ? ' tmux-pane-tab--agent' : ''}`}
              onMouseDown={(e) => {
                e.stopPropagation()
                e.preventDefault()
                handleSelect(pane.index)
                const card = (e.target as HTMLElement).closest('.floating-card')
                const xtermEl = card?.querySelector('.xterm-helper-textarea') as HTMLElement
                if (xtermEl) xtermEl.focus()
              }}
              title={pane.title || `${pane.command} (pane ${pane.index})`}
            >
              <span className="tmux-pane-tab-icon">
                {agent ? <AgentIcon /> : <ShellIcon />}
              </span>
              <span className="tmux-pane-tab-label">
                <span className="tmux-pane-tab-cmd">{displayName}</span>
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
