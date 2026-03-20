import { useState, useEffect, useRef, useCallback } from 'react'
import { useGitStore } from '../store/gitStore'

interface GitBranchSectionProps {
  folderPath: string
}

export function GitBranchSection({ folderPath }: GitBranchSectionProps): React.JSX.Element | null {
  const {
    isRepo,
    currentBranch,
    branches,
    detached,
    loading,
    error,
    setBranches,
    setIsRepo,
    setLoading,
    setError,
    reset
  } = useGitStore()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const fetchBranches = useCallback(
    async (cancelled: { current: boolean }) => {
      setLoading(true)
      setError(null)
      try {
        const isGitRepo = await window.electronAPI.gitIsRepo(folderPath)
        if (cancelled.current) return
        if (!isGitRepo) {
          reset()
          return
        }
        const data = await window.electronAPI.gitBranches(folderPath)
        if (cancelled.current) return
        setBranches(data)
      } catch {
        if (!cancelled.current) {
          setError('Failed to read git info')
        }
      } finally {
        if (!cancelled.current) {
          setLoading(false)
        }
      }
    },
    [folderPath, setBranches, setIsRepo, setLoading, setError, reset]
  )

  useEffect(() => {
    const cancelled = { current: false }
    void fetchBranches(cancelled)
    return () => {
      cancelled.current = true
    }
  }, [fetchBranches])

  // Auto-dismiss error after 5s
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error, setError])

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return
    function handleClick(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen])

  if (!isRepo) return null

  async function handleCheckout(branch: string): Promise<void> {
    setDropdownOpen(false)
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.gitCheckout(folderPath, branch)
    if (!result.ok) {
      setError(result.error ?? 'Checkout failed')
      setLoading(false)
      return
    }
    const cancelled = { current: false }
    await fetchBranches(cancelled)
  }

  return (
    <div className="sidebar-git-section" ref={dropdownRef}>
      <button
        className="sidebar-git-toggle"
        onClick={() => setDropdownOpen((prev) => !prev)}
        aria-expanded={dropdownOpen}
        aria-label="Switch git branch"
      >
        <svg
          className="sidebar-git-icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M11.75 5a2.25 2.25 0 1 0-1 4.39v.36c0 .966-.784 1.75-1.75 1.75H7.25v-1.14a2.25 2.25 0 1 0-1.5 0v4.28a2.25 2.25 0 1 0 1.5 0V12h1.75A3.25 3.25 0 0 0 12.25 8.75v-.36A2.25 2.25 0 0 0 11.75 5ZM6.5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 9.5a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0ZM11 7.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
            fill="var(--fg-secondary)"
          />
        </svg>
        <span className={`sidebar-git-branch-name${detached ? ' sidebar-git-branch-name--detached' : ''}`}>
          {loading ? 'Loading...' : currentBranch}
          {detached && ' (detached)'}
        </span>
        <svg
          className={`sidebar-git-chevron${dropdownOpen ? ' sidebar-git-chevron--open' : ''}`}
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path d="M3 4L5 6L7 4" stroke="var(--fg-secondary)" strokeWidth="1.2" />
        </svg>
      </button>

      {error && <div className="sidebar-git-error">{error}</div>}

      {dropdownOpen && (
        <div className="sidebar-git-dropdown" role="listbox">
          {branches.map((branch) => (
            <button
              key={branch}
              className={`sidebar-git-branch-item${branch === currentBranch ? ' sidebar-git-branch-item--current' : ''}`}
              role="option"
              aria-selected={branch === currentBranch}
              onClick={() => {
                if (branch !== currentBranch) void handleCheckout(branch)
              }}
            >
              {branch === currentBranch && <span className="sidebar-git-current-dot" />}
              <span className="sidebar-git-branch-item-name">{branch}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
