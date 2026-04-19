import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Sun, TerminalSquare, Pencil, Keyboard, Moon, Monitor, X } from 'lucide-react'
import { useAppearanceStore } from '../store/appearanceStore'
import type { AppearanceMode } from '../tokens'

const SCROLLBACK_DEFAULT = 8 * 1024 * 1024
const SCROLLBACK_MIN = 16 * 1024
const SCROLLBACK_MAX = 64 * 1024 * 1024

interface SettingsPanelProps {
  onClose: () => void
}

type SettingsTab = 'appearance' | 'terminal' | 'editor' | 'keybindings'

const tabs: { id: SettingsTab; label: string; icon: React.JSX.Element }[] = [
  {
    id: 'appearance',
    label: 'Appearance',
    icon: <Sun size={16} strokeWidth={1.5} />
  },
  {
    id: 'terminal',
    label: 'Terminal',
    icon: <TerminalSquare size={16} strokeWidth={1.5} />
  },
  {
    id: 'editor',
    label: 'Editor',
    icon: <Pencil size={16} strokeWidth={1.5} />
  },
  {
    id: 'keybindings',
    label: 'Keybindings',
    icon: <Keyboard size={16} strokeWidth={1.5} />
  }
]

const modes: { value: AppearanceMode; label: string; desc: string; icon: React.JSX.Element }[] = [
  {
    value: 'dark',
    label: 'Dark',
    desc: 'Optimized for low-light environments',
    icon: <Moon size={20} strokeWidth={1.5} />
  },
  {
    value: 'light',
    label: 'Light',
    desc: 'Clean and bright for day use',
    icon: <Sun size={20} strokeWidth={1.5} />
  },
  {
    value: 'system',
    label: 'System',
    desc: 'Follow your OS preference',
    icon: <Monitor size={20} strokeWidth={1.5} />
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
  const [scrollbackBytes, setScrollbackBytesState] = useState<number>(SCROLLBACK_DEFAULT)

  useEffect(() => {
    window.electronAPI
      .settingsGet('terminal.scrollbackBytes')
      .then((raw) => {
        if (typeof raw === 'number' && Number.isFinite(raw)) {
          const clamped = Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, raw))
          setScrollbackBytesState(clamped)
        }
      })
      .catch(() => {
        // silently keep default
      })
  }, [])

  const scrollbackMb = scrollbackBytes / (1024 * 1024)

  function handleScrollbackChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const mb = parseFloat(e.target.value)
    if (!Number.isFinite(mb)) return
    const bytes = Math.round(mb * 1024 * 1024)
    const clamped = Math.min(SCROLLBACK_MAX, Math.max(SCROLLBACK_MIN, bytes))
    setScrollbackBytesState(clamped)
    window.electronAPI.settingsSet('terminal.scrollbackBytes', clamped).catch(() => {
      // silent
    })
  }

  return (
    <div className="stg-content">
      <div className="stg-content-header">
        <h2 className="stg-content-title">Terminal</h2>
        <p className="stg-content-desc">Configure terminal behavior and defaults</p>
      </div>

      <div className="stg-group">
        <div className="stg-group-label">Scrollback size</div>
        <div className="stg-setting-row">
          <input
            type="number"
            role="spinbutton"
            className="stg-input"
            min={SCROLLBACK_MIN / (1024 * 1024)}
            max={SCROLLBACK_MAX / (1024 * 1024)}
            step={1}
            value={scrollbackMb}
            onChange={handleScrollbackChange}
            aria-label="Scrollback size in megabytes"
          />
          <span className="stg-input-unit">MB</span>
        </div>
        <p className="stg-setting-hint">
          Maximum in-memory scrollback retained by the sidecar per terminal session. Changes apply
          to newly created sessions only.
        </p>
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
            <X size={12} strokeWidth={1.5} />
          </button>
          {content}
        </div>
      </div>
    </div>,
    document.body
  )
}
