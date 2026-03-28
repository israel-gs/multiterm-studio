import { useState, useEffect } from 'react'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
  openCount: number
}

interface WelcomeScreenProps {
  onSelectProject: (folderPath: string) => void
  onPickFolder: () => void
  onOpenWorkspace?: () => void
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function shortenPath(fullPath: string): string {
  const home = fullPath.replace(/^\/Users\/[^/]+/, '~')
  return home
}

export function WelcomeScreen({
  onSelectProject,
  onPickFolder,
  onOpenWorkspace
}: WelcomeScreenProps): React.JSX.Element {
  const [projects, setProjects] = useState<RecentProject[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.electronAPI.projectsRecent().then((list) => {
      setProjects(list)
      setLoading(false)
    })
  }, [])

  const filtered = searchQuery
    ? projects.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.path.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : projects

  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        {/* Search */}
        <div className="welcome-search">
          <svg
            width="16"
            height="16"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="6" cy="6" r="4.5" stroke="var(--fg-secondary)" strokeWidth="1.2" />
            <line
              x1="9.5"
              y1="9.5"
              x2="13"
              y2="13"
              stroke="var(--fg-secondary)"
              strokeWidth="1.2"
            />
          </svg>
          <input
            className="welcome-search-input"
            type="text"
            placeholder="Search projects..."
            aria-label="Search projects"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="welcome-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        {/* Header */}
        <div className="welcome-header">
          <span className="welcome-header-label">RECENT PROJECTS</span>
        </div>

        {/* Grid */}
        {loading ? (
          <div className="welcome-empty">Loading...</div>
        ) : (
          <div className="welcome-grid">
            {filtered.map((project) => (
              <div key={project.path} className="welcome-card-wrapper">
                <button
                  className="welcome-card"
                  onClick={() => onSelectProject(project.path)}
                >
                  <div className="welcome-card-icon">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 16 16"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
                        fill="var(--fg-secondary)"
                      />
                    </svg>
                  </div>
                  <div className="welcome-card-name">{project.name}</div>
                  <div className="welcome-card-path">{shortenPath(project.path)}</div>
                  <div className="welcome-card-meta">
                    {project.openCount} session{project.openCount !== 1 ? 's' : ''}
                    <span className="welcome-card-dot">&middot;</span>
                    {formatRelativeTime(project.lastOpened)}
                  </div>
                </button>
                <button
                  className="welcome-card-remove"
                  aria-label={`Remove ${project.name} from recents`}
                  onClick={async (e) => {
                    e.stopPropagation()
                    await window.electronAPI.projectsRemove(project.path)
                    setProjects((prev) => prev.filter((p) => p.path !== project.path))
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Select Folder card */}
            <button className="welcome-card welcome-card--add" onClick={onPickFolder}>
              <div className="welcome-card-icon">
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
                    stroke="var(--fg-secondary)"
                    strokeWidth="1"
                    fill="none"
                  />
                  <line
                    x1="8"
                    y1="6"
                    x2="8"
                    y2="12"
                    stroke="var(--fg-secondary)"
                    strokeWidth="1.2"
                  />
                  <line
                    x1="5"
                    y1="9"
                    x2="11"
                    y2="9"
                    stroke="var(--fg-secondary)"
                    strokeWidth="1.2"
                  />
                </svg>
              </div>
              <div className="welcome-card-name">Select Folder</div>
            </button>

            {/* Open Workspace card */}
            {onOpenWorkspace && (
              <button className="welcome-card welcome-card--add" onClick={onOpenWorkspace}>
                <div className="welcome-card-icon">
                  <svg width="24" height="24" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    {/* Two overlapping folders representing multi-folder workspace */}
                    <path
                      d="M3 5.5C3 4.67 3.67 4 4.5 4H7l1 1H12.5C13.33 5 14 5.67 14 6.5V11.5C14 12.33 13.33 13 12.5 13H4.5C3.67 13 3 12.33 3 11.5V5.5Z"
                      stroke="var(--fg-secondary)"
                      strokeWidth="1"
                      fill="none"
                    />
                    <path
                      d="M1 3.5C1 2.67 1.67 2 2.5 2H5l1 1H10.5C11.33 3 12 3.67 12 4.5"
                      stroke="var(--fg-secondary)"
                      strokeWidth="1"
                      fill="none"
                      opacity="0.5"
                    />
                  </svg>
                </div>
                <div className="welcome-card-name">Open Workspace</div>
              </button>
            )}
          </div>
        )}

        {!loading && filtered.length === 0 && searchQuery && (
          <div className="welcome-empty">No projects match &ldquo;{searchQuery}&rdquo;</div>
        )}
      </div>
    </div>
  )
}
