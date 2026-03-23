import { useEffect } from 'react'
import { TerminalSquare, StickyNote, Download, RotateCw, AlertCircle, Loader2 } from 'lucide-react'
import { useUpdateStore } from '../store/updateStore'

interface Props {
  onNewTerminal: () => void
  onNewNote: () => void
}

const isDevMode = !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV

export function CanvasToolbar({ onNewTerminal, onNewNote }: Props): React.JSX.Element {
  const { status, progress, version, initUpdateListener, checkForUpdate, downloadUpdate, installUpdate } =
    useUpdateStore()

  useEffect(() => {
    const unsubscribe = initUpdateListener()
    return unsubscribe
  }, [initUpdateListener])

  const handleUpdateClick = (): void => {
    if (status === 'available') {
      downloadUpdate()
    } else if (status === 'ready') {
      installUpdate()
    } else if (status === 'error') {
      checkForUpdate()
    } else if (isDevMode && (status === 'idle' || status === 'checking')) {
      checkForUpdate()
    }
  }

  const showUpdateButton =
    status === 'available' ||
    status === 'downloading' ||
    status === 'ready' ||
    status === 'installing' ||
    status === 'error' ||
    (isDevMode && (status === 'idle' || status === 'checking'))

  const getUpdateLabel = (): string => {
    switch (status) {
      case 'available':
        return version ? `Update v${version}` : 'Update available'
      case 'downloading':
        return `Updating ${progress ?? 0}%`
      case 'ready':
        return 'Restart to Update'
      case 'installing':
        return 'Installing...'
      case 'error':
        return 'Update failed'
      case 'checking':
        return 'Checking...'
      default:
        return 'Check for Update'
    }
  }

  const getUpdateIcon = (): React.JSX.Element => {
    switch (status) {
      case 'downloading':
      case 'installing':
      case 'checking':
        return <Loader2 size={13} strokeWidth={1.5} className="update-spinner" />
      case 'ready':
        return <RotateCw size={13} strokeWidth={1.5} />
      case 'error':
        return <AlertCircle size={13} strokeWidth={1.5} />
      default:
        return <Download size={13} strokeWidth={1.5} />
    }
  }

  const isDisabled = status === 'downloading' || status === 'installing' || status === 'checking'

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

      {showUpdateButton && (
        <>
          <div className="canvas-toolbar-separator" />
          <button
            className={`canvas-toolbar-update${status === 'error' ? ' is-error' : ''}${isDisabled ? ' is-disabled' : ''}${status === 'ready' ? ' is-ready' : ''}`}
            onClick={handleUpdateClick}
            disabled={isDisabled}
            title={getUpdateLabel()}
            aria-label={getUpdateLabel()}
          >
            {getUpdateIcon()}
            <span>{getUpdateLabel()}</span>
          </button>
        </>
      )}
    </div>
  )
}
