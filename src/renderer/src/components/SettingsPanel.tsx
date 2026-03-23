import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAppearanceStore } from '../store/appearanceStore'
import type { AppearanceMode } from '../tokens'

interface SettingsPanelProps {
  onClose: () => void
}

type SettingsTab = 'appearance' | 'terminal' | 'editor' | 'keybindings'

const tabs: { id: SettingsTab; label: string; icon: React.JSX.Element }[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.42 1.42M11.18 11.18l1.42 1.42M12.6 3.4l-1.42 1.42M4.82 11.18l-1.42 1.42" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M4.5 6.5L6.5 8.5L4.5 10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="8" y1="10.5" x2="11" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M9.5 2L14 6.5 6 14.5H1.5V10L9.5 2Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M8 3.5L12.5 8" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  },
  {
    id: 'keybindings',
    label: 'Keybindings',
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="1" y="4" width="14" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <rect x="3.5" y="6.5" width="2" height="1.5" rx="0.3" fill="currentColor" opacity="0.5" />
        <rect x="7" y="6.5" width="2" height="1.5" rx="0.3" fill="currentColor" opacity="0.5" />
        <rect x="10.5" y="6.5" width="2" height="1.5" rx="0.3" fill="currentColor" opacity="0.5" />
        <rect x="5" y="9.5" width="6" height="1.5" rx="0.3" fill="currentColor" opacity="0.5" />
      </svg>
    )
  }
]

const modes: { value: AppearanceMode; label: string; desc: string; icon: React.JSX.Element }[] = [
  {
    value: 'dark',
    label: 'Dark',
    desc: 'Optimized for low-light environments',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <path d="M17.5 10.83a7.5 7.5 0 1 1-8.33-8.33 6 6 0 0 0 8.33 8.33Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    value: 'light',
    label: 'Light',
    desc: 'Clean and bright for day use',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5.05 5.05l1.41 1.41M13.54 13.54l1.41 1.41M14.95 5.05l-1.41 1.41M6.46 13.54l-1.41 1.41" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  },
  {
    value: 'system',
    label: 'System',
    desc: 'Follow your OS preference',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="3" width="16" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M7 17h6M10 14v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    )
  }
]

function AppearanceSettings(): React.JSX.Element {
  const currentMode = useAppearanceStore((s) => s.mode)
  const setMode = useAppearanceStore((s) => s.setMode)

  return (
    <div className="stg-content">
      <div className="stg-content-header">
        <h2 className="stg-content-title">Appearance</h2>
        <p className="stg-content-desc">Customize the look and feel of the application</p>
      </div>

      <div className="stg-group">
        <div className="stg-group-label">Theme</div>
        <div className="stg-theme-grid">
          {modes.map((m) => (
            <button
              key={m.value}
              className={`stg-theme-card${currentMode === m.value ? ' stg-theme-card--active' : ''}`}
              onClick={() => setMode(m.value)}
            >
              <div className="stg-theme-card-icon">{m.icon}</div>
              <div className="stg-theme-card-text">
                <span className="stg-theme-card-label">{m.label}</span>
                <span className="stg-theme-card-desc">{m.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function TerminalSettings(): React.JSX.Element {
  const [mouseMode, setMouseMode] = useState(true)

  useEffect(() => {
    window.electronAPI.settingsGet('terminal.mouseMode').then((v) => {
      if (typeof v === 'boolean') setMouseMode(v)
    })
  }, [])

  const handleToggle = (): void => {
    const next = !mouseMode
    setMouseMode(next)
    window.electronAPI.settingsSet('terminal.mouseMode', next)
    window.electronAPI.terminalSetMouseMode(next)
  }

  return (
    <div className="stg-content">
      <div className="stg-content-header">
        <h2 className="stg-content-title">Terminal</h2>
        <p className="stg-content-desc">Configure terminal behavior and defaults</p>
      </div>
      <div className="stg-group">
        <div className="stg-group-label">Mouse</div>
        <div className="stg-toggle-row">
          <div className="stg-toggle-info">
            <span className="stg-toggle-label">Tmux mouse mode</span>
            <span className="stg-toggle-desc">Enable mouse scrolling, clicking and selection inside tmux panes</span>
          </div>
          <button
            className={`stg-toggle${mouseMode ? ' stg-toggle--on' : ''}`}
            onClick={handleToggle}
            role="switch"
            aria-checked={mouseMode}
          >
            <span className="stg-toggle-knob" />
          </button>
        </div>
      </div>
    </div>
  )
}

function PlaceholderSettings({ title, desc }: { title: string; desc: string }): React.JSX.Element {
  return (
    <div className="stg-content">
      <div className="stg-content-header">
        <h2 className="stg-content-title">{title}</h2>
        <p className="stg-content-desc">{desc}</p>
      </div>
      <div className="stg-placeholder">
        <span className="stg-placeholder-text">Coming soon</span>
      </div>
    </div>
  )
}

export function SettingsPanel({ onClose }: SettingsPanelProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance')

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const content = (() => {
    switch (activeTab) {
      case 'appearance':
        return <AppearanceSettings />
      case 'terminal':
        return <TerminalSettings />
      case 'editor':
        return <PlaceholderSettings title="Editor" desc="Customize the code editor experience" />
      case 'keybindings':
        return <PlaceholderSettings title="Keybindings" desc="Manage keyboard shortcuts" />
    }
  })()

  return createPortal(
    <div className="stg-backdrop" onClick={onClose}>
      <div className="stg-modal" onClick={(e) => e.stopPropagation()}>
        {/* Sidebar nav */}
        <nav className="stg-nav">
          <div className="stg-nav-header">Settings</div>
          <div className="stg-nav-list">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`stg-nav-item${activeTab === tab.id ? ' stg-nav-item--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="stg-nav-icon">{tab.icon}</span>
                <span className="stg-nav-label">{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="stg-nav-footer">
            <span className="stg-nav-version">Multiterm Studio</span>
          </div>
        </nav>

        {/* Content area */}
        <div className="stg-main">
          <button className="stg-close" onClick={onClose} aria-label="Close settings">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
          {content}
        </div>
      </div>
    </div>,
    document.body
  )
}
