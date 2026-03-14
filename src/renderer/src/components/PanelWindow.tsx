import { MosaicWindow } from 'react-mosaic-component'
import type { MosaicPath } from 'react-mosaic-component'
import { TerminalPanel } from './Terminal'
import { PanelHeader } from './PanelHeader'

interface Props {
  sessionId: string
  path: MosaicPath
}

export function PanelWindow({ sessionId, path }: Props): React.JSX.Element {
  return (
    <MosaicWindow<string>
      path={path}
      title={sessionId}
      createNode={() => crypto.randomUUID()}
      renderToolbar={() => <PanelHeader sessionId={sessionId} path={path} />}
    >
      <div style={{ width: '100%', height: '100%' }}>
        <TerminalPanel sessionId={sessionId} cwd="." />
      </div>
    </MosaicWindow>
  )
}
