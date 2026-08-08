import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Copy } from 'lucide-react'
import { useGitStore } from '../store/gitStore'
import { useProjectStore } from '../store/projectStore'
import { buildGraph, laneColor, type GraphRow } from '../utils/gitGraph'
import { splitDisplayPath, statusColorVar } from '../utils/gitStatus'
import { relativeTime } from '../utils/time'
import type { GitCommit, GitCommitDetail, GitCommitFile, GitRef } from '../../../shared/git'

interface GitHistorySectionProps {
  folderPath: string
}

/** Row height and lane width the SVG gutter is drawn against. */
const ROW_HEIGHT = 34
const LANE_WIDTH = 12
const DOT_RADIUS = 3.5

/** Long enough that running the mouse down the list does not flash cards. */
const HOVER_DELAY_MS = 220
/**
 * Grace period before the card closes, so the pointer can cross the gap between
 * the row and the card to scroll it. The alternative is the "safe triangle" of
 * hover menus, which is not worth its complexity for a straight 8px hop.
 */
const HIDE_DELAY_MS = 180
/** Kept in sync with the card's CSS width, for placing it beside the sidebar. */
const CARD_WIDTH = 340
const CARD_GAP = 8

const STATUS_LETTERS: Record<GitCommitFile['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C'
}

export function GitHistorySection({ folderPath }: GitHistorySectionProps): React.JSX.Element {
  const commits = useGitStore((s) => s.commits)
  const commitsLoading = useGitStore((s) => s.commitsLoading)
  const commitsError = useGitStore((s) => s.commitsError)
  const hasMoreCommits = useGitStore((s) => s.hasMoreCommits)
  const loadMoreCommits = useGitStore((s) => s.loadMoreCommits)
  const [openSha, setOpenSha] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Lanes are derived from the whole loaded page, so a commit's column only
  // makes sense in the context of the ones above it.
  const graph = useMemo(() => buildGraph(commits), [commits])

  return (
    <section className="git-history">
      <button
        className="sidebar-git-group-header"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <ChevronRight
          className={`sidebar-git-chevron${collapsed ? '' : ' sidebar-git-chevron--open'}`}
          size={12}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span className="sidebar-git-group-label">Graph</span>
        {commits.length > 0 && <span className="sidebar-git-group-count">{commits.length}</span>}
      </button>

      {!collapsed && (
        <>
          {commitsError && (
            <p className="sidebar-git-message sidebar-git-message--error">{commitsError}</p>
          )}
          {!commitsError && commits.length === 0 && (
            <p className="sidebar-git-message">
              {commitsLoading ? 'Reading history...' : 'No commits yet'}
            </p>
          )}

          <ul className="git-history-list">
            {commits.map((commit, index) => (
              <CommitRow
                key={commit.sha}
                commit={commit}
                row={graph[index]}
                folderPath={folderPath}
                open={openSha === commit.sha}
                onToggle={() => setOpenSha(openSha === commit.sha ? null : commit.sha)}
              />
            ))}
          </ul>

          {hasMoreCommits && (
            <button
              className="git-history-more"
              onClick={() => void loadMoreCommits(folderPath)}
              disabled={commitsLoading}
            >
              {commitsLoading ? 'Loading...' : 'Load more commits'}
            </button>
          )}
        </>
      )}
    </section>
  )
}

function CommitRow({
  commit,
  row,
  folderPath,
  open,
  onToggle
}: {
  commit: GitCommit
  row: GraphRow | undefined
  folderPath: string
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  const loadCommitDetail = useGitStore((s) => s.loadCommitDetail)
  const detail = useGitStore((s) => s.commitDetails[commit.sha])
  const openDiff = useProjectStore((s) => s.openDiff)
  const rowRef = useRef<HTMLButtonElement>(null)
  // The card is placed against the row's box on screen, so hovering has to
  // capture it: once the card is in a portal it has no layout relationship to
  // the row any more.
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hovered = anchor !== null

  // The file list and the line counts come from the same call, so opening a
  // commit and hovering it both want it — fetched once, cached by sha.
  useEffect(() => {
    if (open || hovered) void loadCommitDetail(folderPath, commit.sha)
  }, [open, hovered, folderPath, commit.sha, loadCommitDetail])

  useEffect(
    () => () => {
      clearTimer(showTimer)
      clearTimer(hideTimer)
    },
    []
  )

  function scheduleShow(): void {
    clearTimer(hideTimer)
    if (anchor) return
    clearTimer(showTimer)
    showTimer.current = setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect()
      if (rect) setAnchor(rect)
    }, HOVER_DELAY_MS)
  }

  function scheduleHide(): void {
    clearTimer(showTimer)
    clearTimer(hideTimer)
    hideTimer.current = setTimeout(() => setAnchor(null), HIDE_DELAY_MS)
  }

  function cancelHide(): void {
    clearTimer(hideTimer)
  }

  return (
    <li className="git-history-item" onMouseEnter={scheduleShow} onMouseLeave={scheduleHide}>
      <button
        ref={rowRef}
        className={`git-history-row${open ? ' git-history-row--open' : ''}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        <GraphGutter row={row} />
        <span className="git-history-text">
          <span className="git-history-subject">{commit.subject}</span>
          <span className="git-history-meta">
            {commit.authorName} · {relativeTime(commit.timestamp)}
          </span>
        </span>
        {commit.refs.length > 0 && (
          <span className="git-history-refs">
            {commit.refs.map((gitRef) => (
              <RefBadge key={`${gitRef.kind}:${gitRef.name}`} gitRef={gitRef} />
            ))}
          </span>
        )}
      </button>

      {anchor && !open && (
        <CommitHoverCard
          commit={commit}
          detail={detail}
          anchor={anchor}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        />
      )}

      {open && (
        <CommitFiles
          detail={detail}
          onOpenFile={(file) => openDiff(`${folderPath}/${file.path}`, false, commit.sha)}
        />
      )}
    </li>
  )
}

/**
 * The lane column: a vertical line for every lane that passes through this row,
 * plus the dot and the lines leaving it towards the commit's parents.
 */
function GraphGutter({ row }: { row: GraphRow | undefined }): React.JSX.Element {
  if (!row) return <span className="git-history-gutter" />

  const width = Math.max(1, row.width) * LANE_WIDTH
  const x = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2
  const mid = ROW_HEIGHT / 2

  return (
    <svg
      className="git-history-gutter"
      width={width}
      height={ROW_HEIGHT}
      viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
      aria-hidden="true"
    >
      {/* Lanes that only pass by: a line from the top edge down to where they
          continue below, so a branch reads as continuous. */}
      {row.lanesBefore.map((sha, lane) =>
        sha && lane !== row.lane ? (
          <line
            key={`before-${lane}`}
            x1={x(lane)}
            y1={0}
            x2={x(lane)}
            y2={row.lanesAfter[lane] ? ROW_HEIGHT : mid}
            stroke={laneColor(lane)}
            strokeWidth={1.5}
          />
        ) : null
      )}

      {/* This commit's own lane above the dot, when a child reserved it. */}
      {row.lanesBefore[row.lane] && (
        <line
          x1={x(row.lane)}
          y1={0}
          x2={x(row.lane)}
          y2={mid}
          stroke={laneColor(row.lane)}
          strokeWidth={1.5}
        />
      )}

      {/* One line per parent. A parent in another lane bends sideways, which is
          what makes a merge visible. */}
      {row.parentLanes.map((parentLane) => (
        <path
          key={`parent-${parentLane}`}
          d={
            parentLane === row.lane
              ? `M ${x(row.lane)} ${mid} L ${x(row.lane)} ${ROW_HEIGHT}`
              : `M ${x(row.lane)} ${mid} C ${x(row.lane)} ${mid + 10}, ${x(parentLane)} ${mid + 6}, ${x(parentLane)} ${ROW_HEIGHT}`
          }
          fill="none"
          stroke={laneColor(parentLane)}
          strokeWidth={1.5}
        />
      ))}

      <circle
        cx={x(row.lane)}
        cy={mid}
        r={DOT_RADIUS}
        fill="var(--bg-card)"
        stroke={laneColor(row.lane)}
        strokeWidth={2}
      />
    </svg>
  )
}

/** Named `gitRef` rather than `ref`: React reserves that prop name. */
function RefBadge({ gitRef }: { gitRef: GitRef }): React.JSX.Element {
  return <span className={`git-history-ref git-history-ref--${gitRef.kind}`}>{gitRef.name}</span>
}

function clearTimer(timer: React.RefObject<ReturnType<typeof setTimeout> | null>): void {
  if (timer.current) clearTimeout(timer.current)
  timer.current = null
}

/**
 * Rendered into document.body rather than beside the row: the sidebar scrolls
 * and clips its content, so a card positioned inside it covered the graph
 * instead of escaping to the side.
 *
 * It takes the pointer, so a long commit message can be scrolled — which is why
 * the row hands it the hover timers rather than closing on its own.
 */
function CommitHoverCard({
  commit,
  detail,
  anchor,
  onMouseEnter,
  onMouseLeave
}: {
  commit: GitCommit
  detail: GitCommitDetail | undefined
  anchor: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
}): React.JSX.Element {
  // Beside the row by default; flipped to the left when the sidebar sits on the
  // right of the window, and anchored to its bottom edge in the lower half of
  // the screen so a tall card cannot run off it.
  const spaceRight = window.innerWidth - anchor.right
  const left =
    spaceRight >= CARD_WIDTH + CARD_GAP
      ? anchor.right + CARD_GAP
      : Math.max(CARD_GAP, anchor.left - CARD_WIDTH - CARD_GAP)
  const anchorFromBottom = anchor.top > window.innerHeight / 2

  return createPortal(
    <div
      className="git-history-card"
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={
        anchorFromBottom
          ? { left, bottom: window.innerHeight - anchor.bottom }
          : { left, top: anchor.top }
      }
    >
      <div className="git-history-card-head">
        <span className="git-history-card-author">{commit.authorName}</span>
        <span className="git-history-card-date">{absoluteTime(commit.timestamp)}</span>
      </div>
      <p className="git-history-card-subject">{commit.subject}</p>
      {commit.body && <p className="git-history-card-body">{commit.body}</p>}
      <div className="git-history-card-foot">
        <span className="git-history-card-sha">{commit.shortSha}</span>
        {detail ? (
          <span className="git-history-card-stat">
            {detail.files.length} {detail.files.length === 1 ? 'file' : 'files'}
            <span className="git-history-adds">+{detail.insertions}</span>
            <span className="git-history-dels">−{detail.deletions}</span>
          </span>
        ) : (
          <span className="git-history-card-stat">Reading changes...</span>
        )}
      </div>
    </div>,
    document.body
  )
}

function CommitFiles({
  detail,
  onOpenFile
}: {
  detail: GitCommitDetail | undefined
  onOpenFile: (file: GitCommitFile) => void
}): React.JSX.Element {
  if (!detail) return <p className="sidebar-git-message">Reading changes...</p>
  if (detail.files.length === 0) {
    return <p className="sidebar-git-message">No file changes in this commit</p>
  }

  return (
    <div className="git-history-files">
      <div className="git-history-files-head">
        <span className="git-history-card-sha">{detail.sha.slice(0, 7)}</span>
        <span className="git-history-adds">+{detail.insertions}</span>
        <span className="git-history-dels">−{detail.deletions}</span>
        <button
          className="git-history-copy"
          onClick={() => window.electronAPI.clipboardWriteText(detail.sha)}
          aria-label="Copy commit id"
          title="Copy commit id"
        >
          <Copy size={11} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <ul>
        {detail.files.map((file) => {
          const { name, dir } = splitDisplayPath(file.path)
          return (
            <li key={file.path}>
              <button
                className="sidebar-git-row"
                onClick={() => onOpenFile(file)}
                title={file.origPath ? `${file.origPath} → ${file.path}` : file.path}
              >
                <span className="sidebar-git-row-name">{name}</span>
                {dir && <span className="sidebar-git-row-dir">{dir}</span>}
                <span
                  className="sidebar-git-row-letter"
                  style={{ color: statusColorVar(file.status) }}
                >
                  {STATUS_LETTERS[file.status]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function absoluteTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}
