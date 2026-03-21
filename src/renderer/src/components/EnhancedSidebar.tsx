import { useState, useEffect } from 'react'
import { FileTree } from './FileTree'
import { GitBranchSection } from './GitBranchSection'
import { SettingsPanel } from './SettingsPanel'
import { useProjectStore } from '../store/projectStore'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
  openCount: number
}

interface EnhancedSidebarProps {
  folderPath: string
  onSwitchProject?: (path: string) => void
  onToggleSidebar?: () => void
}

function shortenPath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+/, '~')
}

export function EnhancedSidebar({
  folderPath,
  onSwitchProject,
  onToggleSidebar
}: EnhancedSidebarProps): React.JSX.Element {
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const folderName = folderPath.split('/').pop() ?? folderPath
  const shortPath = shortenPath(folderPath)

  // Load recent projects when dropdown opens
  useEffect(() => {
    if (!dropdownOpen) return
    window.electronAPI.projectsRecent().then(setRecentProjects)
  }, [dropdownOpen])


  function handleSelectProject(path: string): void {
    setDropdownOpen(false)
    if (path === folderPath) return
    if (onSwitchProject) {
      onSwitchProject(path)
    } else {
      setFolderPath(path)
    }
  }

  async function handleAddWorkspace(): Promise<void> {
    setDropdownOpen(false)
    const selected = await window.electronAPI.folderOpen()
    if (selected) {
      if (onSwitchProject) {
        onSwitchProject(selected)
      } else {
        setFolderPath(selected)
      }
    }
  }

  // Filter out current project from dropdown list
  const otherProjects = recentProjects.filter((p) => p.path !== folderPath)

  return (
    <aside className="enhanced-sidebar">
      {/* Backdrop */}
      {dropdownOpen && (
        <div
          className="sidebar-project-backdrop"
          onClick={() => setDropdownOpen(false)}
        />
      )}

      {/* Top row: toggle + selector */}
      <div className="sidebar-top-row">
        {onToggleSidebar && (
          <button
            className="sidebar-toggle-btn"
            onClick={onToggleSidebar}
            aria-label="Hide sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
              <line x1="5.5" y1="2" x2="5.5" y2="14" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        )}
        <button
          className={`sidebar-project-selector${dropdownOpen ? ' sidebar-project-selector--open' : ''}`}
          onClick={() => setDropdownOpen((prev) => !prev)}
          aria-expanded={dropdownOpen}
          aria-label="Switch project"
        >
          <span className="sidebar-project-label">
            {shortPath.replace(/\/[^/]+$/, '/')}
            <strong>{folderName}</strong>
          </span>
          <svg
            className={`sidebar-project-chevron-icon${dropdownOpen ? ' sidebar-project-chevron-icon--open' : ''}`}
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            aria-hidden="true"
          >
            <path d="M2 3L4 5L6 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Dropdown — inside top-row for correct absolute positioning */}
        {dropdownOpen && (
          <div className="sidebar-project-dropdown">
            {otherProjects.map((project) => {
              const pName = project.path.split('/').pop() ?? project.path
              const pShort = shortenPath(project.path).replace(/\/[^/]+$/, '/')
              return (
                <button
                  key={project.path}
                  className="sidebar-project-dropdown-item"
                  onClick={() => handleSelectProject(project.path)}
                >
                  <span className="sidebar-project-dropdown-path">{pShort}</span>
                  <strong>{pName}</strong>
                </button>
              )
            })}
            <button
              className="sidebar-project-dropdown-item sidebar-project-dropdown-item--add"
              onClick={() => void handleAddWorkspace()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M6 2.5V9.5M2.5 6H9.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Add workspace...
            </button>
          </div>
        )}
      </div>

      {/* Git branch switcher */}
      <GitBranchSection folderPath={folderPath} />

      {/* Search bar */}
      <div className="sidebar-search">
        <svg
          className="sidebar-search-icon"
          width="14"
          height="14"
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
          className="sidebar-search-input"
          type="text"
          placeholder="Search files..."
          aria-label="Search files"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <span className="sidebar-search-shortcut">&#8984;K</span>
      </div>

      {/* Sort controls */}
      <div className="sidebar-sort-controls">
        <span className="sidebar-sort-label">Name</span>
        <button
          className="sidebar-sort-btn"
          onClick={() => setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
          aria-label={`Sort ${sortOrder === 'asc' ? 'Z to A' : 'A to Z'}`}
        >
          {sortOrder === 'asc' ? 'A-Z' : 'Z-A'}
        </button>
      </div>

      {/* File tree */}
      <div className="sidebar-tree-container">
        <FileTree rootPath={folderPath} searchQuery={searchQuery} sortOrder={sortOrder} />
      </div>

      {/* Settings button — pinned to bottom */}
      <div className="sidebar-settings-bar">
        <button
          className="sidebar-settings-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M5.72 1.53a1.2 1.2 0 0 1 2.56 0 1.2 1.2 0 0 0 1.8.79 1.2 1.2 0 0 1 1.6 1.6 1.2 1.2 0 0 0 .79 1.8 1.2 1.2 0 0 1 0 2.56 1.2 1.2 0 0 0-.79 1.8 1.2 1.2 0 0 1-1.6 1.6 1.2 1.2 0 0 0-1.8.79 1.2 1.2 0 0 1-2.56 0 1.2 1.2 0 0 0-1.8-.79 1.2 1.2 0 0 1-1.6-1.6 1.2 1.2 0 0 0-.79-1.8 1.2 1.2 0 0 1 0-2.56 1.2 1.2 0 0 0 .79-1.8 1.2 1.2 0 0 1 1.6-1.6 1.2 1.2 0 0 0 1.8-.79Z" stroke="currentColor" strokeWidth="1.1" />
            <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          Settings
        </button>
      </div>

      {/* Settings panel overlay */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}
