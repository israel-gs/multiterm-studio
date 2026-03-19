import { useState, useEffect, useMemo } from 'react'
import React from 'react'

interface TreeEntry {
  name: string
  isDir: boolean
  itemCount?: number
  modifiedAt?: number
}

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

function FileTreeNode({
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
  const [hovered, setHovered] = useState(false)

  async function handleToggle(): Promise<void> {
    if (!isDir) return

    if (!expanded && children === null) {
      const entries = await window.electronAPI.folderReaddir(path)
      setChildren(entries)
    }

    setExpanded((prev) => !prev)
  }

  const displayChildren = useMemo(() => {
    if (!children) return null
    return sortEntries(filterEntries(children, searchQuery), sortOrder)
  }, [children, searchQuery, sortOrder])

  const icon = isDir ? (expanded ? '📂' : '📁') : '📄'

  return (
    <div>
      <div
        onClick={() => void handleToggle()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="file-tree-node"
        style={{
          paddingLeft: depth * 16,
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent'
        }}
      >
        <span className="file-tree-icon">{icon}</span>
        <span className="file-tree-name" data-entry-name>
          {name}
        </span>
        {isDir && itemCount !== undefined && (
          <span className="file-tree-count">{itemCount}</span>
        )}
        {!isDir && modifiedAt !== undefined && (
          <span className="file-tree-date">{formatDate(modifiedAt)}</span>
        )}
        {isDir && (
          <span className="file-tree-arrow">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      {expanded && displayChildren !== null && (
        <div>
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
}

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
    <div style={{ padding: '4px 0' }}>
      {displayEntries === null ? (
        <div
          style={{
            paddingLeft: 8,
            fontSize: 13,
            color: 'var(--fg-secondary)'
          }}
        >
          Loading...
        </div>
      ) : displayEntries.length === 0 ? (
        <div
          style={{
            paddingLeft: 8,
            fontSize: 13,
            color: 'var(--fg-secondary)'
          }}
        >
          No matches
        </div>
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
