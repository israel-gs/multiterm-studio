import { MosaicWindow } from 'react-mosaic-component'
import type { MosaicPath } from 'react-mosaic-component'
import { TerminalPanel } from './Terminal'
import { PanelHeader } from './PanelHeader'

interface Props {
  sessionId: string
  path: MosaicPath
  cwd: string
}

export function PanelWindow({ sessionId, path, cwd }: Props): React.JSX.Element {
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
      <div style={{ width: '100%', height: '100%' }}>
        <TerminalPanel sessionId={sessionId} cwd={cwd} />
      </div>
    </MosaicWindow>
  )
}
