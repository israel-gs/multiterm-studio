import { MosaicLayout } from './components/MosaicLayout'

function App(): React.JSX.Element {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-main)'
      }}
    >
      <MosaicLayout />
    </div>
  )
}

export default App
