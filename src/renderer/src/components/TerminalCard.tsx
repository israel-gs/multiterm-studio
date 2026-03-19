import { CardHeader } from './CardHeader'
import { TerminalPanel } from './Terminal'
import { usePanelStore } from '../store/panelStore'

interface Props {
  sessionId: string
  cwd: string
  onClose: (id: string) => void
}

export function TerminalCard({ sessionId, cwd, onClose }: Props): React.JSX.Element {
  const clearAttention = usePanelStore((s) => s.clearAttention)

  return (
    <div className="terminal-card">
      <CardHeader sessionId={sessionId} onClose={() => onClose(sessionId)} />
      <div
        className="terminal-card-body"
        onClick={() => clearAttention(sessionId)}
        onFocus={() => clearAttention(sessionId)}
      >
        <div className="terminal-card-inner">
          <TerminalPanel sessionId={sessionId} cwd={cwd} />
        </div>
      </div>
    </div>
  )
}
