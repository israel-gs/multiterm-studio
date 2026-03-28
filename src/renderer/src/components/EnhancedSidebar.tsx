import { useState, useEffect } from 'react'
import { PanelLeft, ChevronDown, Plus, Search, Settings, FolderPlus, Save, FolderOpen } from 'lucide-react'
import { FileTree, MultiRootFileTree, SortMode } from './FileTree'
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
  folderPaths?: string[]
  onSwitchProject?: (path: string) => void
  onAddFolder?: () => void
  onRemoveFolder?: (path: string) => void
  onSaveWorkspace?: () => void
  onToggleSidebar?: () => void
}

function shortenPath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+/, '~')
}

export function EnhancedSidebar({
  folderPath,
  folderPaths,
  onSwitchProject,
  onAddFolder,
  onRemoveFolder,
  onSaveWorkspace,
  onToggleSidebar
}: EnhancedSidebarProps): React.JSX.Element {
  const effectivePaths = folderPaths && folderPaths.length > 0 ? folderPaths : [folderPath]
  const isMultiRoot = effectivePaths.length > 1
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<SortMode>('alpha-asc')
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
            <PanelLeft size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
        <button
          className={`sidebar-project-selector${dropdownOpen ? ' sidebar-project-selector--open' : ''}`}
          onClick={() => setDropdownOpen((prev) => !prev)}
          aria-expanded={dropdownOpen}
          aria-label="Switch project"
        >
          <span className="sidebar-project-label">
            <span className="sidebar-project-label-prefix">{shortPath.replace(/\/[^/]+$/, '/')}</span>
            <strong>{folderName}</strong>
          </span>
          <ChevronDown
            className={`sidebar-project-chevron-icon${dropdownOpen ? ' sidebar-project-chevron-icon--open' : ''}`}
            size={8}
            strokeWidth={1.5}
            aria-hidden="true"
          />
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
            {otherProjects.length > 0 && <div className="sidebar-project-dropdown-separator" />}
            <button
              className="sidebar-project-dropdown-item sidebar-project-dropdown-item--add"
              onClick={() => void handleAddWorkspace()}
              aria-label="Open folder"
            >
              <FolderOpen size={12} strokeWidth={1.5} aria-hidden="true" />
              Open folder...
            </button>
            {onAddFolder && (
              <button
                className="sidebar-project-dropdown-item sidebar-project-dropdown-item--add"
                onClick={() => { setDropdownOpen(false); onAddFolder() }}
                aria-label="Add folder to workspace"
              >
                <FolderPlus size={12} strokeWidth={1.5} aria-hidden="true" />
                Add folder to workspace...
              </button>
            )}
            {onSaveWorkspace && (
              <button
                className="sidebar-project-dropdown-item sidebar-project-dropdown-item--add"
                onClick={() => { setDropdownOpen(false); onSaveWorkspace() }}
                aria-label="Save workspace"
              >
                <Save size={12} strokeWidth={1.5} aria-hidden="true" />
                Save workspace as...
              </button>
            )}
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="sidebar-search">
        <Search
          className="sidebar-search-icon"
          size={14}
          strokeWidth={1.5}
          aria-hidden="true"
        />
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
        <span className="sidebar-sort-label">
          {sortOrder.startsWith('alpha') ? 'Name' : 'Modified'}
        </span>
        <button
          className="sidebar-sort-btn"
          onClick={() =>
            setSortOrder((prev) => {
              const cycle: SortMode[] = ['alpha-asc', 'alpha-desc', 'modified-desc', 'modified-asc']
              const idx = cycle.indexOf(prev)
              return cycle[(idx + 1) % cycle.length]
            })
          }
          aria-label={`Sort mode: ${sortOrder}`}
        >
          {sortOrder === 'alpha-asc'
            ? 'A-Z'
            : sortOrder === 'alpha-desc'
              ? 'Z-A'
              : sortOrder === 'modified-desc'
                ? 'Newest'
                : 'Oldest'}
        </button>
      </div>

      {/* File tree */}
      <div className="sidebar-tree-container">
        {isMultiRoot ? (
          <MultiRootFileTree rootPaths={effectivePaths} searchQuery={searchQuery} sortOrder={sortOrder} />
        ) : (
          <FileTree rootPath={folderPath} searchQuery={searchQuery} sortOrder={sortOrder} />
        )}
      </div>

      {/* Bottom bar — branch + settings icon */}
      <div className="sidebar-bottom-bar">
        <GitBranchSection folderPath={folderPath} />
        <button
          className="sidebar-settings-icon-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
        >
          <Settings size={15} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      {/* Settings panel overlay */}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </aside>
  )
}
