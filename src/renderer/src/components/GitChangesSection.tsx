import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useGitStore } from '../store/gitStore'
import { useProjectStore } from '../store/projectStore'
import {
  groupStatusFiles,
  isDirectoryEntry,
  splitDisplayPath,
  statusColorVar,
  statusLetter,
  type GitStatusGroups
} from '../utils/gitStatus'
import type { GitFileStatus } from '../../../shared/git'

interface GitChangesSectionProps {
  /** The repository to report on. Multi-root workspaces show their first root. */
  folderPath: string
}

const GROUP_ORDER: { key: keyof GitStatusGroups; label: string; side: 'index' | 'worktree' }[] = [
  { key: 'conflicts', label: 'Merge conflicts', side: 'worktree' },
  { key: 'staged', label: 'Staged changes', side: 'index' },
  { key: 'changes', label: 'Changes', side: 'worktree' },
  { key: 'untracked', label: 'Untracked', side: 'worktree' }
]

/**
 * The Source Control view: every path git reports, grouped the way the next
 * commit will treat it. Reads the store only — {@link useGitStatusSync} owns
 * keeping it fresh, so this view can unmount without the count badge on the
 * tab going stale.
 */
export function GitChangesSection({ folderPath }: GitChangesSectionProps): React.JSX.Element {
  const isRepo = useGitStore((s) => s.isRepo)
  const status = useGitStore((s) => s.status)
  const statusPath = useGitStore((s) => s.statusPath)
  const statusError = useGitStore((s) => s.statusError)
  const openFileInEditor = useProjectStore((s) => s.openFileInEditor)
  const openDiff = useProjectStore((s) => s.openDiff)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  const forThisFolder = statusPath === folderPath && status ? status : null
  const groups = useMemo(
    () => groupStatusFiles(forThisFolder ? forThisFolder.files : []),
    [forThisFolder]
  )
  const total = forThisFolder ? forThisFolder.files.length : 0

  function toggleGroup(key: string): void {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handleOpen(file: GitFileStatus, side: 'index' | 'worktree'): void {
    const absolute = `${folderPath}/${file.path}`
    // An untracked file has no committed side to compare against, so a diff of
    // it would just be the whole file marked as added — the file itself is
    // what you actually want to look at.
    if (file.worktree === 'untracked') {
      openFileInEditor(absolute)
      return
    }
    openDiff(absolute, side === 'index')
  }

  if (!isRepo) {
    return (
      <div className="sidebar-git-view">
        <p className="sidebar-git-message">Not a git repository</p>
      </div>
    )
  }

  return (
    <div className="sidebar-git-view">
      {statusError && (
        <p className="sidebar-git-message sidebar-git-message--error">{statusError}</p>
      )}
      {!statusError && total === 0 && <p className="sidebar-git-message">Working tree clean</p>}

      {GROUP_ORDER.map(({ key, label, side }) => {
        const files = groups[key]
        if (files.length === 0) return null
        const collapsed = collapsedGroups.has(key)
        return (
          <section className="sidebar-git-group" key={key}>
            <button
              className="sidebar-git-group-header"
              onClick={() => toggleGroup(key)}
              aria-expanded={!collapsed}
            >
              <ChevronRight
                className={`sidebar-git-chevron${collapsed ? '' : ' sidebar-git-chevron--open'}`}
                size={12}
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <span className="sidebar-git-group-label">{label}</span>
              <span className="sidebar-git-group-count">{files.length}</span>
            </button>
            {!collapsed && (
              <ul>
                {files.map((file) => (
                  <GitChangeRow
                    key={`${key}:${file.path}`}
                    file={file}
                    side={side}
                    onOpen={(f) => handleOpen(f, side)}
                  />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

function GitChangeRow({
  file,
  side,
  onOpen
}: {
  file: GitFileStatus
  side: 'index' | 'worktree'
  onOpen: (file: GitFileStatus) => void
}): React.JSX.Element {
  const { name, dir } = splitDisplayPath(file.path)
  const state = file[side]
  // git collapses a wholly untracked folder into a single entry. There is no
  // file to open behind it, so it is reported rather than offered as an action.
  const isDir = isDirectoryEntry(file.path)

  const body = (
    <>
      <span className="sidebar-git-row-name">{name}</span>
      {dir && <span className="sidebar-git-row-dir">{dir}</span>}
      <span className="sidebar-git-row-letter" style={{ color: statusColorVar(state) }}>
        {statusLetter(file, side)}
      </span>
    </>
  )

  if (isDir) {
    return (
      <li>
        <div className="sidebar-git-row sidebar-git-row--dir" title={`Untracked folder ${name}`}>
          {body}
        </div>
      </li>
    )
  }

  return (
    <li>
      <button
        className="sidebar-git-row"
        onClick={() => onOpen(file)}
        title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
      >
        {body}
      </button>
    </li>
  )
}
