import { useState } from 'react'
import { FileTree } from './FileTree'
import { useProjectStore } from '../store/projectStore'

interface EnhancedSidebarProps {
  folderPath: string
}

export function EnhancedSidebar({ folderPath }: EnhancedSidebarProps): React.JSX.Element {
  const setFolderPath = useProjectStore((s) => s.setFolderPath)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')

  const folderName = folderPath.split('/').pop() ?? folderPath

  async function handlePickFolder(): Promise<void> {
    const selected = await window.electronAPI.folderOpen()
    if (selected) {
      setFolderPath(selected)
    }
  }

  return (
    <aside className="enhanced-sidebar">
      {/* Project selector */}
      <button
        className="sidebar-project-selector"
        onClick={() => void handlePickFolder()}
        aria-label="Change project folder"
      >
        <div className="sidebar-project-icon">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1 3.5C1 2.67 1.67 2 2.5 2H6l1.5 1.5H13.5C14.33 3.5 15 4.17 15 5V12.5C15 13.33 14.33 14 13.5 14H2.5C1.67 14 1 13.33 1 12.5V3.5Z"
              fill="var(--fg-secondary)"
            />
          </svg>
        </div>
        <div className="sidebar-project-info">
          <div className="sidebar-project-name">{folderName}</div>
          <div className="sidebar-project-path">{folderPath}</div>
        </div>
        <span className="sidebar-project-chevron" aria-hidden="true">&#8250;</span>
      </button>

      {/* Search bar */}
      <div className="sidebar-search">
        <svg className="sidebar-search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" stroke="var(--fg-secondary)" strokeWidth="1.2" />
          <line x1="9.5" y1="9.5" x2="13" y2="13" stroke="var(--fg-secondary)" strokeWidth="1.2" />
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
    </aside>
  )
}
