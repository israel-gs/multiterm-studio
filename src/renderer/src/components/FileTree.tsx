import { useState, useEffect, useMemo, useCallback } from 'react'
import React from 'react'

interface TreeEntry {
  name: string
  isDir: boolean
  itemCount?: number
  modifiedAt?: number
}

// --- Icons (inline SVGs, no external deps) ---

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      className={`file-tree-chevron${expanded ? ' file-tree-chevron--open' : ''}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function FolderIcon({ open }: { open: boolean }): React.JSX.Element {
  if (open) {
    return (
      <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M1.5 4C1.5 3.17 2.17 2.5 3 2.5h3.17l1.5 1.5H13c.83 0 1.5.67 1.5 1.5v1H3.5L1.5 12V4z" fill="var(--color-folder)" />
        <path d="M2.5 6.5h12l-2 7h-10l2-7z" fill="var(--color-folder-open)" fillOpacity="0.7" />
      </svg>
    )
  }
  return (
    <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.5 4C1.5 3.17 2.17 2.5 3 2.5h3.17l1.5 1.5H13c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H3c-.83 0-1.5-.67-1.5-1.5V4z"
        fill="var(--color-folder)"
      />
    </svg>
  )
}

function getFileIcon(name: string): React.JSX.Element {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''

  // Code files
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'swift', 'kt'].includes(ext)) {
    return (
      <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="var(--color-blue)" strokeWidth="1.2" fill="none" />
        <path d="M5.5 6.5L4 8l1.5 1.5M10.5 6.5L12 8l10.5 1.5" stroke="var(--color-blue)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  // Config/data files
  if (['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'conf', 'config'].includes(ext)) {
    return (
      <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="var(--color-green)" strokeWidth="1.2" fill="none" />
        <path d="M5 5.5h6M5 8h4M5 10.5h5" stroke="var(--color-green)" strokeWidth="1" strokeLinecap="round" />
      </svg>
    )
  }

  // Markdown/docs
  if (['md', 'mdx', 'txt', 'rst', 'doc', 'docx', 'pdf'].includes(ext)) {
    return (
      <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="var(--color-yellow)" strokeWidth="1.2" fill="none" />
        <path d="M5 5h6M5 7.5h6M5 10h3" stroke="var(--color-yellow)" strokeWidth="1" strokeLinecap="round" />
      </svg>
    )
  }

  // Style files
  if (['css', 'scss', 'sass', 'less', 'styl'].includes(ext)) {
    return (
      <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="var(--color-purple)" strokeWidth="1.2" fill="none" />
        <path d="M6 5.5c-1 0-1.5.5-1.5 1s.5 1 1.5 1 1.5.5 1.5 1-.5 1-1.5 1" stroke="var(--color-purple)" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }

  // Image files
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return (
      <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="var(--color-cyan)" strokeWidth="1.2" fill="none" />
        <circle cx="6" cy="5.5" r="1.5" stroke="var(--color-cyan)" strokeWidth="1" fill="none" />
        <path d="M3 11l3-3 2 2 2-2 3 3" stroke="var(--color-cyan)" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  // Default file
  return (
    <svg className="file-tree-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M3.5 2A1.5 1.5 0 002 3.5v9A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5V5.5L10.5 2H3.5z"
        stroke="var(--fg-secondary)"
        strokeWidth="1.2"
        fill="none"
      />
      <path d="M10 2v4h4" stroke="var(--fg-secondary)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function SpinnerIcon(): React.JSX.Element {
  return (
    <svg className="file-tree-icon file-tree-spinner" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="var(--fg-secondary)" strokeWidth="1.5" strokeDasharray="10 20" strokeLinecap="round" />
    </svg>
  )
}

// --- Helpers ---

function formatDate(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sortEntries(entries: TreeEntry[], order: 'asc' | 'desc'): TreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    const cmp = a.name.localeCompare(b.name)
    return order === 'asc' ? cmp : -cmp
  })
}

function filterEntries(entries: TreeEntry[], query: string): TreeEntry[] {
  if (!query) return entries
  const lq = query.toLowerCase()
  return entries.filter((e) => e.name.toLowerCase().includes(lq))
}

// --- FileTreeNode ---

interface FileTreeNodeProps {
  path: string
  name: string
  isDir: boolean
  depth: number
  itemCount?: number
  modifiedAt?: number
  searchQuery: string
  sortOrder: 'asc' | 'desc'
}

const FileTreeNode = React.memo(function FileTreeNode({
  path,
  name,
  isDir,
  depth,
  itemCount,
  modifiedAt,
  searchQuery,
  sortOrder
}: FileTreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<TreeEntry[] | null>(null)
  const [loading, setLoading] = useState(false)

  const handleToggle = useCallback(async (): Promise<void> => {
    if (!isDir) return

    if (!expanded && children === null) {
      setLoading(true)
      const entries = await window.electronAPI.folderReaddir(path)
      setChildren(entries)
      setLoading(false)
    }

    setExpanded((prev) => !prev)
  }, [isDir, expanded, children, path])

  const displayChildren = useMemo(() => {
    if (!children) return null
    return sortEntries(filterEntries(children, searchQuery), sortOrder)
  }, [children, searchQuery, sortOrder])

  const isHidden = name.startsWith('.')

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? expanded : undefined}
        onClick={() => void handleToggle()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void handleToggle()
          }
        }}
        className={`file-tree-node${isHidden ? ' file-tree-node--hidden' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {/* Chevron (folders only) */}
        {isDir ? (
          <ChevronIcon expanded={expanded} />
        ) : (
          <span className="file-tree-chevron-spacer" />
        )}

        {/* Icon */}
        {isDir ? <FolderIcon open={expanded} /> : getFileIcon(name)}

        {/* Name */}
        <span className="file-tree-name" data-entry-name>
          {name}
        </span>

        {/* Loading spinner */}
        {loading && <SpinnerIcon />}

        {/* Folder item count */}
        {isDir && !loading && itemCount !== undefined && (
          <span className="file-tree-count">{itemCount}</span>
        )}

        {/* File modified date */}
        {!isDir && modifiedAt !== undefined && (
          <span className="file-tree-date">{formatDate(modifiedAt)}</span>
        )}
      </div>
      {expanded && displayChildren !== null && (
        <div role="group">
          {displayChildren.map((child) => (
            <FileTreeNode
              key={`${path}/${child.name}`}
              path={`${path}/${child.name}`}
              name={child.name}
              isDir={child.isDir}
              depth={depth + 1}
              itemCount={child.itemCount}
              modifiedAt={child.modifiedAt}
              searchQuery={searchQuery}
              sortOrder={sortOrder}
            />
          ))}
        </div>
      )}
    </div>
  )
})

// --- FileTree ---

interface FileTreeProps {
  rootPath: string
  searchQuery?: string
  sortOrder?: 'asc' | 'desc'
}

export function FileTree({
  rootPath,
  searchQuery = '',
  sortOrder = 'asc'
}: FileTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null)

  useEffect(() => {
    setEntries(null)
    window.electronAPI.folderReaddir(rootPath).then((result) => {
      setEntries(result)
    })
  }, [rootPath])

  const displayEntries = useMemo(() => {
    if (!entries) return null
    return sortEntries(filterEntries(entries, searchQuery), sortOrder)
  }, [entries, searchQuery, sortOrder])

  return (
    <div role="tree" aria-label="File tree" style={{ padding: '4px 0' }}>
      {displayEntries === null ? (
        <div className="file-tree-status">
          <SpinnerIcon />
          <span>Loading...</span>
        </div>
      ) : displayEntries.length === 0 ? (
        <div className="file-tree-status">No matches</div>
      ) : (
        displayEntries.map((entry) => (
          <FileTreeNode
            key={`${rootPath}/${entry.name}`}
            path={`${rootPath}/${entry.name}`}
            name={entry.name}
            isDir={entry.isDir}
            depth={1}
            itemCount={entry.itemCount}
            modifiedAt={entry.modifiedAt}
            searchQuery={searchQuery}
            sortOrder={sortOrder}
          />
        ))
      )}
    </div>
  )
}
