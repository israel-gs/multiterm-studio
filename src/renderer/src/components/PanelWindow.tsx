import { MosaicWindow } from 'react-mosaic-component'
import type { MosaicPath } from 'react-mosaic-component'
import { TerminalPanel } from './Terminal'
import { PanelHeader } from './PanelHeader'
import { usePanelStore } from '../store/panelStore'

interface Props {
  sessionId: string
  path: MosaicPath
  cwd: string
}

export function PanelWindow({ sessionId, path, cwd }: Props): React.JSX.Element {
  const clearAttention = usePanelStore((s) => s.clearAttention)

  return (
    <MosaicWindow<string>
      path={path}
      title={sessionId}
      createNode={() => crypto.randomUUID()}
      renderToolbar={() => (
        <div style={{ width: '100%' }}>
          <PanelHeader sessionId={sessionId} path={path} />
        </div>
      )}
    >
      {/* Click/focus clears attention badge for this panel */}
      <div
        style={{ width: '100%', height: '100%' }}
        onClick={() => clearAttention(sessionId)}
        onFocus={() => clearAttention(sessionId)}
      >
        <TerminalPanel sessionId={sessionId} cwd={cwd} />
      </div>
    </MosaicWindow>
  )
}
