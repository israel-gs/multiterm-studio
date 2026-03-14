import { useRef } from 'react'
import { TerminalPanel } from './components/Terminal'

function App(): React.JSX.Element {
  // useRef keeps sessionId stable across re-renders (no new PTY on each render)
  const sessionId = useRef(crypto.randomUUID()).current

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-main)'
      }}
    >
      <TerminalPanel sessionId={sessionId} cwd="." />
    </div>
  )
}

export default App
