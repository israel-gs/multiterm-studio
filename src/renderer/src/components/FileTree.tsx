import { useState, useEffect } from 'react'
import React from 'react'

interface TreeEntry {
  name: string
  isDir: boolean
}

interface FileTreeNodeProps {
  path: string
  name: string
  isDir: boolean
  depth: number
}

function FileTreeNode({ path, name, isDir, depth }: FileTreeNodeProps): React.JSX.Element {
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

  const indicator = isDir ? (expanded ? '\u25BE' : '\u25B8') : ' '

  return (
    <div>
      <div
        onClick={() => void handleToggle()}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          paddingLeft: depth * 16,
          fontSize: 13,
          lineHeight: '22px',
          color: 'var(--fg-primary)',
          cursor: isDir ? 'pointer' : 'default',
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        <span style={{ marginRight: 4 }}>{indicator}</span>
        <span data-entry-name>{name}</span>
      </div>
      {expanded && children !== null && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={`${path}/${child.name}`}
              path={`${path}/${child.name}`}
              name={child.name}
              isDir={child.isDir}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface FileTreeProps {
  rootPath: string
}

export function FileTree({ rootPath }: FileTreeProps): React.JSX.Element {
  const [entries, setEntries] = useState<TreeEntry[] | null>(null)

  useEffect(() => {
    setEntries(null)
    window.electronAPI.folderReaddir(rootPath).then((result) => {
      setEntries(result)
    })
  }, [rootPath])

  const rootName = rootPath.split('/').pop() ?? rootPath

  return (
    <div style={{ padding: '8px 0' }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--fg-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          paddingLeft: 8,
          paddingBottom: 4
        }}
      >
        {rootName}
      </div>
      {entries === null ? (
        <div
          style={{
            paddingLeft: 8,
            fontSize: 13,
            color: 'var(--fg-secondary)'
          }}
        >
          Loading...
        </div>
      ) : (
        entries.map((entry) => (
          <FileTreeNode
            key={`${rootPath}/${entry.name}`}
            path={`${rootPath}/${entry.name}`}
            name={entry.name}
            isDir={entry.isDir}
            depth={1}
          />
        ))
      )}
    </div>
  )
}
