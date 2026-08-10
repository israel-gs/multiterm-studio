import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useGitStore } from '../store/gitStore'
import { GitHistorySection } from './GitHistorySection'
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

/** Smallest a pane may be dragged to: its header plus a row or two. */
const MIN_PANE_HEIGHT = 90
/** Height of the Changes pane before anything is dragged. */
const DEFAULT_CHANGES_HEIGHT = 260

const GROUP_ORDER: { key: keyof GitStatusGroups; label: string; side: 'index' | 'worktree' }[] = [
  { key: 'conflicts', label: 'Merge conflicts', side: 'worktree' },
  { key: 'staged', label: 'Staged', side: 'index' },
  // Not "Changes": the pane containing it is already called that.
  { key: 'changes', label: 'Unstaged', side: 'worktree' },
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
    <SourceControlPanes folderPath={folderPath} changesCount={total} changes={renderChanges()} />
  )

  function renderChanges(): React.JSX.Element {
    return (
      <>
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
      </>
    )
  }
}

/**
 * Changes and Graph as two stacked panes with a draggable divider.
 *
 * They used to share one scroll area, so a long history pushed the changed
 * files out of reach. Each pane scrolls on its own now, and collapsing one
 * hands its space to the other.
 */
function SourceControlPanes({
  folderPath,
  changesCount,
  changes
}: {
  folderPath: string
  changesCount: number
  changes: React.ReactNode
}): React.JSX.Element {
  const commitCount = useGitStore((s) => s.commits.length)
  const containerRef = useRef<HTMLDivElement>(null)
  const [changesHeight, setChangesHeight] = useState(DEFAULT_CHANGES_HEIGHT)
  const [changesCollapsed, setChangesCollapsed] = useState(false)
  const [graphCollapsed, setGraphCollapsed] = useState(false)

  useEffect(() => {
    void Promise.all([
      window.electronAPI.settingsGet('ui.sourceControl.changesHeight'),
      window.electronAPI.settingsGet('ui.sourceControl.changesCollapsed'),
      window.electronAPI.settingsGet('ui.sourceControl.graphCollapsed')
    ]).then(([height, changesHidden, graphHidden]) => {
      if (typeof height === 'number') setChangesHeight(Math.max(MIN_PANE_HEIGHT, height))
      if (typeof changesHidden === 'boolean') setChangesCollapsed(changesHidden)
      if (typeof graphHidden === 'boolean') setGraphCollapsed(graphHidden)
    })
  }, [])

  function toggleChanges(): void {
    setChangesCollapsed((prev) => {
      window.electronAPI.settingsSet('ui.sourceControl.changesCollapsed', !prev)
      return !prev
    })
  }

  function toggleGraph(): void {
    setGraphCollapsed((prev) => {
      window.electronAPI.settingsSet('ui.sourceControl.graphCollapsed', !prev)
      return !prev
    })
  }

  // The divider only means anything while both panes are open; with one
  // collapsed there is nothing to divide.
  const splitActive = !changesCollapsed && !graphCollapsed
  // Only an open pane may grow. Letting the graph pane keep `flex: 1` while
  // collapsed left its header stranded above a block of empty space.
  const changesGrows = !changesCollapsed && graphCollapsed
  const graphGrows = !graphCollapsed

  function handleDragStart(e: React.MouseEvent): void {
    e.preventDefault()
    const startY = e.clientY
    const startHeight = changesHeight
    const container = containerRef.current

    function heightAt(clientY: number): number {
      const available = container?.getBoundingClientRect().height ?? 0
      // Leave room for the other pane; with no measurable container (a test,
      // or a hidden sidebar) only the lower bound applies.
      const max = available > 0 ? Math.max(MIN_PANE_HEIGHT, available - MIN_PANE_HEIGHT) : Infinity
      return Math.min(max, Math.max(MIN_PANE_HEIGHT, startHeight + clientY - startY))
    }

    document.body.classList.add('sidebar-resizing')
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    function onMove(ev: MouseEvent): void {
      setChangesHeight(heightAt(ev.clientY))
    }

    function onUp(ev: MouseEvent): void {
      document.body.classList.remove('sidebar-resizing')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)

      const finalHeight = heightAt(ev.clientY)
      setChangesHeight(finalHeight)
      window.electronAPI.settingsSet('ui.sourceControl.changesHeight', finalHeight)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className="sidebar-git-view" ref={containerRef}>
      <section
        className={`sc-pane${changesGrows ? ' sc-pane--grow' : ''}`}
        style={splitActive ? { flex: `0 0 ${changesHeight}px` } : undefined}
      >
        <PaneHeader
          label="Changes"
          count={changesCount}
          collapsed={changesCollapsed}
          onToggle={toggleChanges}
        />
        {!changesCollapsed && <div className="sc-pane-body">{changes}</div>}
      </section>

      {splitActive && (
        <div
          className="sc-splitter"
          onMouseDown={handleDragStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize changes"
        />
      )}

      <section className={`sc-pane${graphGrows ? ' sc-pane--grow' : ''}`}>
        <PaneHeader
          label="Graph"
          count={commitCount}
          collapsed={graphCollapsed}
          onToggle={toggleGraph}
        />
        {!graphCollapsed && (
          <div className="sc-pane-body">
            <GitHistorySection folderPath={folderPath} />
          </div>
        )}
      </section>
    </div>
  )
}

function PaneHeader({
  label,
  count,
  collapsed,
  onToggle
}: {
  label: string
  count: number
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button className="sc-pane-header" onClick={onToggle} aria-expanded={!collapsed}>
      <ChevronRight
        className={`sidebar-git-chevron${collapsed ? '' : ' sidebar-git-chevron--open'}`}
        size={12}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className="sidebar-git-group-label">{label}</span>
      {count > 0 && <span className="sidebar-git-group-count">{count}</span>}
    </button>
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
