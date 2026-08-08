import { useState, useEffect } from 'react'
import {
  PanelLeft,
  ChevronDown,
  Search,
  Settings,
  FolderPlus,
  Save,
  FolderOpen,
  Files,
  GitBranch
} from 'lucide-react'
import { FileTree, MultiRootFileTree, SortMode } from './FileTree'
import { GitBranchSection } from './GitBranchSection'
import { GitChangesSection } from './GitChangesSection'
import { SearchView } from './SearchView'
import { useGitStatusSync } from '../hooks/useGitStatusSync'
import { useGitStore } from '../store/gitStore'
import { SettingsPanel } from './SettingsPanel'
import { useProjectStore } from '../store/projectStore'
import { basename } from '../utils/path'

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
  onOpenWorkspace?: (path: string) => void
  onOpenWorkspaceDialog?: () => void
  onAddFolder?: () => void
  onRemoveFolder?: (path: string) => void
  onSaveWorkspace?: () => void
  onToggleSidebar?: () => void
}

function shortenPath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+/, '~')
}

type SidebarView = 'files' | 'search' | 'git'

const VIEWS: { id: SidebarView; label: string; Icon: typeof Files }[] = [
  { id: 'files', label: 'Explorer', Icon: Files },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'git', label: 'Source Control', Icon: GitBranch }
]

export function EnhancedSidebar({
  folderPath,
  folderPaths,
  onSwitchProject,
  onOpenWorkspace,
  onOpenWorkspaceDialog,
  onAddFolder,
  onRemoveFolder,
  onSaveWorkspace,
  onToggleSidebar
}: EnhancedSidebarProps): React.JSX.Element {
  const effectivePaths = folderPaths && folderPaths.length > 0 ? folderPaths : [folderPath]
  const isMultiRoot = effectivePaths.length > 1
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const [sortOrder, setSortOrder] = useState<SortMode>('alpha-asc')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [view, setView] = useState<SidebarView>('files')
  const folderName = basename(folderPath) || folderPath
  const shortPath = shortenPath(folderPath)

  // Mounted here rather than inside the Source Control view so the tab badge
  // stays correct while the explorer is the visible view.
  useGitStatusSync(effectivePaths[0])
  const changeCount = useGitStore((s) =>
    s.statusPath === effectivePaths[0] ? (s.status?.files.length ?? 0) : 0
  )

  // Load recent projects when dropdown opens
  useEffect(() => {
    if (!dropdownOpen) return
    window.electronAPI.projectsRecent().then(setRecentProjects)
  }, [dropdownOpen])

  function handleSelectProject(path: string): void {
    setDropdownOpen(false)
    if (path === folderPath) return
    const isWs = path.endsWith('.multiterm-workspace') || path.endsWith('.code-workspace')
    if (isWs && onOpenWorkspace) {
      onOpenWorkspace(path)
    } else if (onSwitchProject) {
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
        <div className="sidebar-project-backdrop" onClick={() => setDropdownOpen(false)} />
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
            <span className="sidebar-project-label-prefix">
              {shortPath.replace(/\/[^/]+$/, '/')}
            </span>
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
              const pName = basename(project.path) || project.path
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
                onClick={() => {
                  setDropdownOpen(false)
                  onAddFolder()
                }}
                aria-label="Add folder to workspace"
              >
                <FolderPlus size={12} strokeWidth={1.5} aria-hidden="true" />
                Add folder to workspace...
              </button>
            )}
            {onOpenWorkspaceDialog && (
              <button
                className="sidebar-project-dropdown-item sidebar-project-dropdown-item--add"
                onClick={() => {
                  setDropdownOpen(false)
                  onOpenWorkspaceDialog()
                }}
                aria-label="Open workspace file"
              >
                <FolderOpen size={12} strokeWidth={1.5} aria-hidden="true" />
                Open workspace...
              </button>
            )}
            {onSaveWorkspace && (
              <button
                className="sidebar-project-dropdown-item sidebar-project-dropdown-item--add"
                onClick={() => {
                  setDropdownOpen(false)
                  onSaveWorkspace()
                }}
                aria-label="Save workspace"
              >
                <Save size={12} strokeWidth={1.5} aria-hidden="true" />
                Save workspace as...
              </button>
            )}
          </div>
        )}
      </div>

      {/* View switcher — explorer / source control */}
      <nav className="sidebar-views" aria-label="Sidebar views">
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`sidebar-view-btn${view === id ? ' sidebar-view-btn--active' : ''}`}
            onClick={() => setView(id)}
            aria-pressed={view === id}
            aria-label={label}
            title={label}
          >
            <Icon size={17} strokeWidth={1.5} aria-hidden="true" />
            {id === 'git' && changeCount > 0 && (
              <span className="sidebar-view-badge">{changeCount}</span>
            )}
          </button>
        ))}
      </nav>

      {view === 'files' ? (
        <>
          {/* Sort controls */}
          <div className="sidebar-sort-controls">
            <span className="sidebar-sort-label">
              {sortOrder.startsWith('alpha') ? 'Name' : 'Modified'}
            </span>
            <button
              className="sidebar-sort-btn"
              onClick={() =>
                setSortOrder((prev) => {
                  const cycle: SortMode[] = [
                    'alpha-asc',
                    'alpha-desc',
                    'modified-desc',
                    'modified-asc'
                  ]
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
          <div
            className="sidebar-tree-container"
            onContextMenu={async (e) => {
              // Only show background context menu if click is on the container itself
              if ((e.target as HTMLElement).closest('.file-tree-node')) return
              e.preventDefault()
              const items = [
                { id: 'new-file', label: 'New File' },
                { id: 'new-folder', label: 'New Folder' },
                { id: 'separator', label: '' },
                { id: 'reveal-finder', label: 'Reveal in Finder' },
                ...(onAddFolder
                  ? [
                      { id: 'separator', label: '' },
                      { id: 'add-folder', label: 'Add folder to workspace...' }
                    ]
                  : [])
              ]
              const action = await window.electronAPI.contextMenuShow(items)
              if (!action) return
              const targetPath = folderPath
              if (action === 'new-file') {
                await window.electronAPI.fileCreate(`${targetPath}/Untitled.md`)
                useProjectStore.getState().bumpFsRefresh()
              } else if (action === 'new-folder') {
                await window.electronAPI.folderCreate(`${targetPath}/New Folder`)
                useProjectStore.getState().bumpFsRefresh()
              } else if (action === 'reveal-finder') {
                window.electronAPI.shellShowItemInFolder(targetPath)
              } else if (action === 'add-folder') {
                onAddFolder?.()
              }
            }}
          >
            {isMultiRoot ? (
              <MultiRootFileTree
                rootPaths={effectivePaths}
                sortOrder={sortOrder}
                onRemoveFromWorkspace={onRemoveFolder}
              />
            ) : (
              <FileTree rootPath={folderPath} sortOrder={sortOrder} />
            )}
          </div>
        </>
      ) : view === 'search' ? (
        <SearchView rootPaths={effectivePaths} />
      ) : (
        <GitChangesSection folderPath={effectivePaths[0]} />
      )}

      {/* Bottom bar — branch + settings icon */}
      <div className="sidebar-bottom-bar">
        <GitBranchSection folderPath={folderPath} folderPaths={effectivePaths} />
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
