import { useContext } from 'react'
import { MosaicWindow, MosaicContext } from 'react-mosaic-component'
import type { MosaicPath } from 'react-mosaic-component'
import { TerminalPanel } from './Terminal'

interface Props {
  sessionId: string
  path: MosaicPath
}

function CloseButton({ path }: { path: MosaicPath }): React.JSX.Element {
  const { mosaicActions } = useContext(MosaicContext)
  return (
    <button
      onClick={() => mosaicActions.remove(path)}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--fg-secondary)',
        cursor: 'pointer',
        fontSize: '14px',
        padding: '0 4px',
        lineHeight: 1
      }}
      title="Close panel"
    >
      ×
    </button>
  )
}

export function PanelWindow({ sessionId, path }: Props): React.JSX.Element {
  return (
    <MosaicWindow<string>
      path={path}
      title={sessionId}
      createNode={() => crypto.randomUUID()}
      renderToolbar={() => (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 8px',
            background: 'var(--bg-header)',
            height: '100%',
            minHeight: '28px'
          }}
        >
          <span
            style={{
              fontSize: '12px',
              color: 'var(--fg-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            Terminal
          </span>
          <CloseButton path={path} />
        </div>
      )}
    >
      <div style={{ width: '100%', height: '100%' }}>
        <TerminalPanel sessionId={sessionId} cwd="." />
      </div>
    </MosaicWindow>
  )
}
