import { useState, useEffect, useMemo, useCallback } from 'react'
import React from 'react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FileCode2,
  FileCog,
  FileText,
  FileImage,
  File,
  Palette,
  Package,
  FileLock2,
  Terminal,
  Database,
  GitBranch,
  FileJson,
  FileType,
  Shield,
  Loader2,
  Plus,
  TerminalSquare
} from 'lucide-react'
import { useProjectStore } from '../store/projectStore'

interface TreeEntry {
  name: string
  isDir: boolean
  itemCount?: number
  modifiedAt?: number
}

// --- Icons ---

const ICON_SIZE = 16
const ICON_STROKE = 1.5

function ChevronIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <ChevronRight
      className={`file-tree-chevron${expanded ? ' file-tree-chevron--open' : ''}`}
      size={ICON_SIZE}
      strokeWidth={ICON_STROKE}
    />
  )
}

function FolderIconComponent({ open }: { open: boolean }): React.JSX.Element {
  const Icon = open ? FolderOpen : Folder
  return <Icon className="file-tree-icon" size={ICON_SIZE} strokeWidth={ICON_STROKE} color="var(--color-folder)" />
}

function SpinnerIcon(): React.JSX.Element {
  return <Loader2 className="file-tree-icon file-tree-spinner" size={14} strokeWidth={ICON_STROKE} color="var(--fg-secondary)" />
}

function getFileIcon(name: string): React.JSX.Element {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : ''
  const lowerName = name.toLowerCase()
  const props = { className: 'file-tree-icon', size: ICON_SIZE, strokeWidth: ICON_STROKE }

  // Special filenames
  if (lowerName === 'package.json' || lowerName === 'package-lock.json' || lowerName === 'cargo.toml')
    return <Package {...props} color="var(--color-green)" />
  if (lowerName === 'pnpm-lock.yaml' || lowerName === 'yarn.lock' || lowerName === 'bun.lockb')
    return <FileLock2 {...props} color="var(--color-yellow)" />
  if (lowerName === '.gitignore' || lowerName === '.gitmodules' || lowerName === '.gitattributes')
    return <GitBranch {...props} color="var(--color-red)" />
  if (lowerName === 'license' || lowerName === 'license.md' || lowerName === 'licence')
    return <Shield {...props} color="var(--color-yellow)" />
  if (lowerName === 'dockerfile' || lowerName === 'docker-compose.yml' || lowerName === 'docker-compose.yaml')
    return <Package {...props} color="var(--color-blue)" />

  // By extension
  // Code
  if (['ts', 'tsx'].includes(ext)) return <FileCode2 {...props} color="var(--color-blue)" />
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return <FileCode2 {...props} color="var(--color-yellow)" />
  if (['py'].includes(ext)) return <FileCode2 {...props} color="var(--color-green)" />
  if (['rb', 'go', 'rs', 'c', 'cpp', 'h', 'java', 'swift', 'kt', 'lua', 'zig'].includes(ext))
    return <FileCode2 {...props} color="var(--color-blue)" />
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext)) return <Terminal {...props} color="var(--color-green)" />

  // Config/data
  if (['json', 'jsonc'].includes(ext)) return <FileJson {...props} color="var(--color-yellow)" />
  if (['yaml', 'yml', 'toml', 'xml', 'ini', 'env', 'conf', 'config'].includes(ext))
    return <FileCog {...props} color="var(--color-green)" />

  // Styles
  if (['css', 'scss', 'sass', 'less', 'styl'].includes(ext))
    return <Palette {...props} color="var(--color-purple)" />

  // Docs/text
  if (['md', 'mdx'].includes(ext)) return <FileText {...props} color="var(--color-cyan)" />
  if (['txt', 'rst', 'doc', 'docx', 'pdf'].includes(ext))
    return <FileText {...props} color="var(--color-yellow)" />

  // Images
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif'].includes(ext))
    return <FileImage {...props} color="var(--color-cyan)" />

  // Fonts
  if (['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(ext))
    return <FileType {...props} color="var(--color-purple)" />

  // Database
  if (['sql', 'sqlite', 'db'].includes(ext)) return <Database {...props} color="var(--color-yellow)" />

  // Lock files
  if (ext === 'lock') return <FileLock2 {...props} color="var(--color-yellow)" />

  // Default
  return <File {...props} color="var(--fg-secondary)" />
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

export type SortMode = 'alpha-asc' | 'alpha-desc' | 'modified-desc' | 'modified-asc'

function sortEntries(entries: TreeEntry[], order: SortMode): TreeEntry[] {
  return [...entries].sort((a, b) => {
    // Folders always come first
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1

    if (order === 'modified-desc' || order === 'modified-asc') {
      const aTime = a.modifiedAt ?? 0
      const bTime = b.modifiedAt ?? 0
      const cmp = aTime - bTime
      return order === 'modified-desc' ? -cmp : cmp
    }

    const cmp = a.name.localeCompare(b.name)
    return order === 'alpha-asc' ? cmp : -cmp
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
  sortOrder: SortMode
  startRenaming?: boolean
  defaultExpanded?: boolean
  isWorkspaceRoot?: boolean
  onRemoveFromWorkspace?: (path: string) => void
}

const FileTreeNode = React.memo(function FileTreeNode({
  path,
  name,
  isDir,
  depth,
  itemCount,
  modifiedAt,
  searchQuery,
  sortOrder,
  startRenaming: startRenamingProp,
  defaultExpanded,
  isWorkspaceRoot,
  onRemoveFromWorkspace
}: FileTreeNodeProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false)
  const [children, setChildren] = useState<TreeEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [renaming, setRenaming] = useState(startRenamingProp ?? false)
  const [renameValue, setRenameValue] = useState(name)
  const [newChildRename, setNewChildRename] = useState<string | null>(null)
  const openFileInEditor = useProjectStore((s) => s.openFileInEditor)
  const bumpFsRefresh = useProjectStore((s) => s.bumpFsRefresh)
  const fsRefreshKey = useProjectStore((s) => s.fsRefreshKey)

  // Auto-load children when defaultExpanded and on fsRefresh
  useEffect(() => {
    if (isDir && expanded && children === null) {
      setLoading(true)
      window.electronAPI.folderReaddir(path).then((entries) => {
        setChildren(entries)
        setLoading(false)
      })
    }
  }, [isDir, expanded, path]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh children when fsRefreshKey changes (file operations)
  useEffect(() => {
    if (isDir && expanded) {
      window.electronAPI.folderReaddir(path).then((entries) => {
        setChildren(entries)
      })
    }
  }, [fsRefreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = useCallback(async (): Promise<void> => {
    if (!isDir) {
      openFileInEditor(path)
      return
    }

    if (!expanded && children === null) {
      setLoading(true)
      const entries = await window.electronAPI.folderReaddir(path)
      setChildren(entries)
      setLoading(false)
    }

    setExpanded((prev) => !prev)
  }, [isDir, expanded, children, path, openFileInEditor])

  // Context menu handler
  const handleContextMenu = useCallback(async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()

    const menuItems = isDir
      ? [
          { id: 'new-file', label: 'New File' },
          { id: 'new-folder', label: 'New Folder' },
          { id: 'separator', label: '' },
          ...(isWorkspaceRoot ? [] : [
            { id: 'rename', label: 'Rename' },
            { id: 'delete', label: 'Delete' },
            { id: 'separator', label: '' },
          ]),
          { id: 'reveal-finder', label: 'Reveal in Finder' },
          { id: 'copy-path', label: 'Copy Path' },
          ...(isWorkspaceRoot && onRemoveFromWorkspace ? [
            { id: 'separator', label: '' },
            { id: 'remove-from-workspace', label: 'Remove folder from workspace' }
          ] : [])
        ]
      : [
          { id: 'rename', label: 'Rename' },
          { id: 'delete', label: 'Delete' },
          { id: 'separator', label: '' },
          { id: 'reveal-finder', label: 'Reveal in Finder' },
          { id: 'copy-path', label: 'Copy Path' }
        ]

    const action = await window.electronAPI.contextMenuShow(menuItems)
    if (!action) return

    switch (action) {
      case 'rename':
        setRenameValue(name)
        setRenaming(true)
        break
      case 'delete':
        try {
          await window.electronAPI.fileTrash(path)
          bumpFsRefresh()
        } catch (err) {
          console.error('Trash failed:', err)
        }
        break
      case 'copy-path':
        await navigator.clipboard.writeText(path)
        break
      case 'new-file':
        try {
          await window.electronAPI.fileCreate(`${path}/Untitled.md`)
          setLoading(true)
          const fileEntries = await window.electronAPI.folderReaddir(path)
          setChildren(fileEntries)
          setLoading(false)
          setExpanded(true)
          setNewChildRename('Untitled.md')
          bumpFsRefresh()
        } catch (err) {
          console.error('Create file failed:', err)
        }
        break
      case 'new-folder':
        try {
          await window.electronAPI.folderCreate(`${path}/New Folder`)
          setLoading(true)
          const folderEntries = await window.electronAPI.folderReaddir(path)
          setChildren(folderEntries)
          setLoading(false)
          setExpanded(true)
          setNewChildRename('New Folder')
          bumpFsRefresh()
        } catch (err) {
          console.error('Create folder failed:', err)
        }
        break
      case 'reveal-finder':
        window.electronAPI.shellShowItemInFolder?.(path) ??
          window.electronAPI.contextMenuShow([{ id: '_noop', label: 'Not available' }])
        break
      case 'remove-from-workspace':
        onRemoveFromWorkspace?.(path)
        break
    }
  }, [isDir, path, name, expanded, bumpFsRefresh, onRemoveFromWorkspace])

  // Drag start handler (files and folders)
  const handleDragStart = useCallback((e: React.DragEvent): void => {
    e.dataTransfer.setData('application/x-multiterm-file', JSON.stringify({ path, name, isDir }))
    e.dataTransfer.effectAllowed = 'copyMove'
  }, [path, name, isDir])

  // Drag over handler (folders only — they accept drops)
  const handleDragOver = useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    e.currentTarget.classList.add('file-tree-node--drop-target')
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent): void => {
    e.currentTarget.classList.remove('file-tree-node--drop-target')
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.classList.remove('file-tree-node--drop-target')
    const raw = e.dataTransfer.getData('application/x-multiterm-file')
    if (!raw) return
    const data = JSON.parse(raw) as { path: string; name: string; isDir: boolean }
    if (data.path === path) return // don't drop on self
    try {
      await window.electronAPI.fileMove(data.path, path)
      bumpFsRefresh()
    } catch (err) {
      console.error('Move failed:', err)
    }
  }, [path, bumpFsRefresh])

  const displayChildren = useMemo(() => {
    if (!children) return null
    return sortEntries(filterEntries(children, searchQuery), sortOrder)
  }, [children, searchQuery, sortOrder])

  // Clear newChildRename after it's been consumed
  useEffect(() => {
    if (newChildRename) {
      const timer = setTimeout(() => setNewChildRename(null), 100)
      return () => clearTimeout(timer)
    }
  }, [newChildRename])

  const isHidden = name.startsWith('.')

  return (
    <div>
      <div
        role="treeitem"
        tabIndex={0}
        aria-expanded={isDir ? expanded : undefined}
        draggable
        onDragStart={handleDragStart}
        {...(isDir ? { onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: (e: React.DragEvent) => void handleDrop(e) } : {})}
        onClick={() => void handleToggle()}
        onContextMenu={(e) => void handleContextMenu(e)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            void handleToggle()
          }
          if (e.key === 'F2') {
            e.preventDefault()
            setRenameValue(name)
            setRenaming(true)
          }
        }}
        className={`file-tree-node${isHidden ? ' file-tree-node--hidden' : ''}${depth === 0 ? ' file-tree-node--root' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {/* Indent guide lines */}
        {depth > 0 && Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            className="file-tree-indent-guide"
            style={{ left: i * 12 + 10 }}
          />
        ))}
        {/* Chevron (folders only) */}
        {isDir ? (
          <ChevronIcon expanded={expanded} />
        ) : (
          <span className="file-tree-chevron-spacer" />
        )}

        {/* Icon */}
        {isDir ? <FolderIconComponent open={expanded} /> : getFileIcon(name)}

        {/* Name or inline rename input */}
        {renaming ? (
          <input
            className="file-tree-rename-input"
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onFocus={(e) => {
              // Select filename without extension for easy overwrite
              const dot = renameValue.lastIndexOf('.')
              if (dot > 0 && !isDir) {
                e.target.setSelectionRange(0, dot)
              } else {
                e.target.select()
              }
            }}
            onKeyDown={async (e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && renameValue.trim()) {
                try {
                  await window.electronAPI.fileRename(path, renameValue.trim())
                  setRenaming(false)
                  bumpFsRefresh()
                } catch (err) {
                  console.error('Rename failed:', err)
                }
              }
              if (e.key === 'Escape') {
                setRenaming(false)
                setRenameValue(name)
              }
            }}
            onBlur={() => { setRenaming(false); setRenameValue(name) }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="file-tree-name" data-entry-name>
            {name}
            {isDir && !loading && itemCount !== undefined && (
              <span className="file-tree-count">{itemCount}</span>
            )}
          </span>
        )}

        {/* Loading spinner */}
        {loading && <SpinnerIcon />}

        {/* Folder action buttons: new file/folder + open terminal */}
        {isDir && !loading && (
          <span className="file-tree-actions">
            <button
              className="file-tree-action-btn"
              title="New file or folder"
              onClick={async (e) => {
                e.stopPropagation()
                const menuItems = [
                  { id: 'new-file', label: 'New File' },
                  { id: 'new-folder', label: 'New Folder' }
                ]
                const action = await window.electronAPI.contextMenuShow(menuItems)
                if (action === 'new-file') {
                  try {
                    await window.electronAPI.fileCreate(`${path}/Untitled.md`)
                    const entries = await window.electronAPI.folderReaddir(path)
                    setChildren(entries)
                    setExpanded(true)
                    setNewChildRename('Untitled.md')
                    bumpFsRefresh()
                  } catch (err) { console.error('Create file failed:', err) }
                } else if (action === 'new-folder') {
                  try {
                    await window.electronAPI.folderCreate(`${path}/New Folder`)
                    const entries = await window.electronAPI.folderReaddir(path)
                    setChildren(entries)
                    setExpanded(true)
                    setNewChildRename('New Folder')
                    bumpFsRefresh()
                  } catch (err) { console.error('Create folder failed:', err) }
                }
              }}
            >
              <Plus size={14} strokeWidth={1.8} />
            </button>
            <button
              className="file-tree-action-btn"
              title="Open terminal here"
              onClick={(e) => {
                e.stopPropagation()
                useProjectStore.getState().openTerminalAt(path)
              }}
            >
              <TerminalSquare size={14} strokeWidth={1.8} />
            </button>
          </span>
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
              startRenaming={newChildRename === child.name ? true : undefined}
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
  sortOrder?: SortMode
}

export function FileTree({
  rootPath,
  searchQuery = '',
  sortOrder = 'alpha-asc'
}: FileTreeProps): React.JSX.Element {
  const rootName = rootPath.split('/').pop() || rootPath

  return (
    <div role="tree" aria-label="File tree" style={{ padding: '4px 0' }}>
      <FileTreeNode
        key={rootPath}
        path={rootPath}
        name={rootName}
        isDir
        depth={0}
        searchQuery={searchQuery}
        sortOrder={sortOrder}
        defaultExpanded
      />
    </div>
  )
}

interface MultiRootFileTreeProps {
  rootPaths: string[]
  searchQuery?: string
  sortOrder?: SortMode
  onRemoveFromWorkspace?: (path: string) => void
}

export function MultiRootFileTree({
  rootPaths,
  searchQuery = '',
  sortOrder = 'alpha-asc',
  onRemoveFromWorkspace
}: MultiRootFileTreeProps): React.JSX.Element {
  return (
    <div role="tree" aria-label="File tree" style={{ padding: '4px 0' }}>
      {rootPaths.map((rootPath, i) => {
        const rootName = rootPath.split('/').pop() || rootPath
        return (
          <div key={rootPath} className="file-tree-root-section">
            {i > 0 && <div className="file-tree-root-separator" />}
            <FileTreeNode
              path={rootPath}
              name={rootName}
              isDir
              depth={0}
              searchQuery={searchQuery}
              sortOrder={sortOrder}
              defaultExpanded
              isWorkspaceRoot={rootPaths.length > 1}
              onRemoveFromWorkspace={onRemoveFromWorkspace}
            />
          </div>
        )
      })}
    </div>
  )
}
