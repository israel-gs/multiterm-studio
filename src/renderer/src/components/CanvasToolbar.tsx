interface Props {
  onNewTerminal: () => void
  onNewNote: () => void
}

function TerminalIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 6.5L6.5 8.5L4.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8" y1="10.5" x2="11" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function NoteIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5" y1="8" x2="11" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5" y1="11" x2="8.5" y2="11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
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
        <TerminalIcon />
      </button>
      <button
        className="canvas-toolbar-btn"
        onClick={onNewNote}
        title="New note"
        aria-label="New note"
      >
        <NoteIcon />
      </button>
    </div>
  )
}
