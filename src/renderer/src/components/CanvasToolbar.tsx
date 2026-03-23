import { TerminalSquare, StickyNote } from 'lucide-react'

interface Props {
  onNewTerminal: () => void
  onNewNote: () => void
}

export function CanvasToolbar({ onNewTerminal, onNewNote }: Props): React.JSX.Element {
  return (
    <div className="canvas-toolbar">
      <button
        className="canvas-toolbar-btn"
        onClick={onNewTerminal}
        title="New terminal"
        aria-label="New terminal"
      >
        <TerminalSquare size={16} strokeWidth={1.5} />
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onNewNote}
        title="New note"
        aria-label="New note"
      >
        <StickyNote size={16} strokeWidth={1.5} />
      </button>
    </div>
  )
}
