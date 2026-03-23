import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  onCreateTerminal: (name: string, command: string) => void
  onDismiss: () => void
}

interface Preset {
  id: string
  name: string
  command: string
  icon: () => React.JSX.Element
}

function ClaudeIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M12 3L14.5 8.5L20 9.5L16 13.5L17 19L12 16L7 19L8 13.5L4 9.5L9.5 8.5L12 3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function CodexIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 9.5L7 12L9 14.5M15 9.5L17 12L15 14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function OpenCodeIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M9 10L7.5 12L9 14M15 10L16.5 12L15 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="11" y1="9" x2="13" y2="15" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function ShellIcon(): React.JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M7 8L11 12L7 16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="13" y1="16" x2="17" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

const PRESETS: Preset[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', icon: ClaudeIcon },
  { id: 'codex', name: 'Codex', command: 'codex', icon: CodexIcon },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', icon: OpenCodeIcon },
  { id: 'shell', name: 'Shell', command: '', icon: ShellIcon }
]

const SETTINGS_KEY = 'terminal.presetCommands'

export function NewTerminalModal({ onCreateTerminal, onDismiss }: Props): React.JSX.Element {
  const [selectedPreset, setSelectedPreset] = useState('shell')
  const [name, setName] = useState('Shell')
  const [command, setCommand] = useState('')
  const [savedCommands, setSavedCommands] = useState<Record<string, string>>({})
  const nameRef = useRef<HTMLInputElement>(null)

  // Load saved commands per preset on mount
  useEffect(() => {
    window.electronAPI.settingsGet(SETTINGS_KEY).then((v) => {
      if (v && typeof v === 'object') {
        setSavedCommands(v as Record<string, string>)
      }
    })
  }, [])

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    },
    [onDismiss]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const selectPreset = (preset: Preset): void => {
    setSelectedPreset(preset.id)
    setName(preset.name)
    // Use saved command if available, otherwise use preset default
    setCommand(savedCommands[preset.id] ?? preset.command)
  }

  const handleCreate = (): void => {
    const trimmedCommand = command.trim()
    // Save the command for this preset if it differs from default
    const preset = PRESETS.find((p) => p.id === selectedPreset)
    if (preset && trimmedCommand !== preset.command) {
      const next = { ...savedCommands, [selectedPreset]: trimmedCommand }
      setSavedCommands(next)
      window.electronAPI.settingsSet(SETTINGS_KEY, next)
    }
    onCreateTerminal(name.trim() || 'Terminal', trimmedCommand)
    onDismiss()
  }

  return createPortal(
    <div className="ntm-backdrop" onMouseDown={onDismiss}>
      <div className="ntm-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="ntm-title">New Terminal</h2>

        <div className="ntm-section-label">Quick Start</div>
        <div className="ntm-presets">
          {PRESETS.map((preset) => {
            const Icon = preset.icon
            return (
              <button
                key={preset.id}
                className={`ntm-preset${selectedPreset === preset.id ? ' ntm-preset--active' : ''}`}
                onClick={() => selectPreset(preset)}
              >
                <span className="ntm-preset-icon"><Icon /></span>
                <span className="ntm-preset-name">{preset.name}</span>
              </button>
            )
          })}
        </div>

        <div className="ntm-fields">
          <label className="ntm-field">
            <span className="ntm-field-label">Name</span>
            <input
              ref={nameRef}
              className="ntm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            />
          </label>
          <label className="ntm-field">
            <span className="ntm-field-label">Command</span>
            <input
              className="ntm-input ntm-input--mono"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="(default shell)"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            />
          </label>
        </div>

        <div className="ntm-actions">
          <button className="ntm-btn ntm-btn--secondary" onClick={onDismiss}>Cancel</button>
          <button className="ntm-btn ntm-btn--primary" onClick={handleCreate}>Create</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
