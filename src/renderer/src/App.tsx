// Minimal placeholder — Plan 03 replaces this with the full terminal workspace UI
function App(): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-main)',
        color: 'var(--fg-primary)',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: '24px',
        fontWeight: 600,
        userSelect: 'none'
      }}
    >
      Multiterm Studio
    </div>
  )
}

export default App
