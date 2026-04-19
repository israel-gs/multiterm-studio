import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Sparkles, Brain, Code2, Terminal } from 'lucide-react'

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

const PRESETS: Preset[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    icon: () => <Sparkles size={24} strokeWidth={1.3} />
  },
  {
    id: 'codex',
    name: 'Codex',
    command: 'codex',
    icon: () => <Brain size={24} strokeWidth={1.3} />
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    icon: () => <Code2 size={24} strokeWidth={1.3} />
  },
  { id: 'shell', name: 'Shell', command: '', icon: () => <Terminal size={24} strokeWidth={1.3} /> }
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
                <span className="ntm-preset-icon">
                  <Icon />
                </span>
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
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
          </label>
          <label className="ntm-field">
            <span className="ntm-field-label">Command</span>
            <input
              className="ntm-input ntm-input--mono"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="(default shell)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
              }}
            />
          </label>
        </div>

        <div className="ntm-actions">
          <button className="ntm-btn ntm-btn--secondary" onClick={onDismiss}>
            Cancel
          </button>
          <button className="ntm-btn ntm-btn--primary" onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
