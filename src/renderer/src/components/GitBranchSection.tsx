import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { GitBranch, ChevronDown, Search, Plus, X, Check, Trash2 } from 'lucide-react'
import { useGitStore } from '../store/gitStore'

interface GitBranchSectionProps {
  folderPath: string
  folderPaths?: string[]
}

export function GitBranchSection({ folderPath, folderPaths }: GitBranchSectionProps): React.JSX.Element | null {
  const effectivePaths = folderPaths && folderPaths.length > 0 ? folderPaths : [folderPath]
  const isMulti = effectivePaths.length > 1
  const [activeFolderIdx, setActiveFolderIdx] = useState(0)
  const activeFolder = effectivePaths[activeFolderIdx] ?? effectivePaths[0]
  const activeFolderName = activeFolder.split('/').pop() ?? activeFolder

  // Reset index if folderPaths change
  useEffect(() => {
    setActiveFolderIdx(0)
  }, [folderPaths?.length])

  // Override folderPath with activeFolder for all git operations below
  // eslint-disable-next-line no-param-reassign
  folderPath = activeFolder
  const {
    isRepo,
    currentBranch,
    branches,
    detached,
    loading,
    error,
    setBranches,
    setLoading,
    setError,
    reset
  } = useGitStore()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [newBranchName, setNewBranchName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)

  const filteredBranches = useMemo(() => {
    const sorted = [...branches].sort((a, b) => {
      if (a === currentBranch) return -1
      if (b === currentBranch) return 1
      return a.localeCompare(b)
    })
    const q = searchQuery.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter((b) => b.toLowerCase().includes(q))
  }, [branches, currentBranch, searchQuery])

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
    [folderPath, setBranches, setLoading, setError, reset]
  )

  useEffect(() => {
    const cancelled = { current: false }
    void fetchBranches(cancelled)
    return () => {
      cancelled.current = true
    }
  }, [fetchBranches])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(timer)
  }, [error, setError])

  useEffect(() => {
    if (!dropdownOpen && !folderDropdownOpen) return
    function handleClick(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setFolderDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [dropdownOpen, folderDropdownOpen])

  useEffect(() => {
    if (!dropdownOpen) {
      setSearchQuery('')
      setNewBranchName('')
    }
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

  async function handleCreateBranch(): Promise<void> {
    const name = newBranchName.trim()
    if (!name) return
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.gitCreateBranch(folderPath, name)
    if (!result.ok) {
      setError(result.error ?? 'Failed to create branch')
      setLoading(false)
      return
    }
    setNewBranchName('')
    const cancelled = { current: false }
    await fetchBranches(cancelled)
  }

  async function handleDeleteBranch(branch: string): Promise<void> {
    if (!window.confirm(`Delete branch "${branch}"?`)) return
    setLoading(true)
    setError(null)
    const result = await window.electronAPI.gitDeleteBranch(folderPath, branch)
    if (!result.ok) {
      setError(result.error ?? 'Failed to delete branch')
      setLoading(false)
      return
    }
    const cancelled = { current: false }
    await fetchBranches(cancelled)
  }

  function handleToggleDropdown(): void {
    const nextOpen = !dropdownOpen
    setDropdownOpen(nextOpen)
    if (nextOpen) {
      const cancelled = { current: false }
      void fetchBranches(cancelled)
    }
  }

  return (
    <div className="sidebar-branch-manager" ref={containerRef}>
      <div className="sidebar-branch-trigger-row">
        {isMulti && (
          <div className="sidebar-branch-folder-picker-wrap">
            <button
              className="sidebar-branch-folder-picker"
              onClick={(e) => {
                e.stopPropagation()
                setFolderDropdownOpen((prev) => !prev)
                setDropdownOpen(false)
              }}
              title={activeFolder}
              aria-label={`Git repo: ${activeFolderName}`}
              aria-expanded={folderDropdownOpen}
            >
              <span className="sidebar-branch-folder-name">{activeFolderName}</span>
              <ChevronDown
                className={`sidebar-branch-trigger-chevron${folderDropdownOpen ? ' sidebar-branch-trigger-chevron--open' : ''}`}
                size={8}
                strokeWidth={1.8}
                aria-hidden="true"
              />
            </button>
            {folderDropdownOpen && (
              <div className="sidebar-branch-folder-dropdown" role="listbox" aria-label="Select project">
                {effectivePaths.map((fp, idx) => {
                  const name = fp.split('/').pop() ?? fp
                  const isCurrent = idx === activeFolderIdx
                  return (
                    <button
                      key={fp}
                      className={`sidebar-branch-folder-dropdown-item${isCurrent ? ' sidebar-branch-folder-dropdown-item--current' : ''}`}
                      role="option"
                      aria-selected={isCurrent}
                      onClick={() => {
                        setActiveFolderIdx(idx)
                        setFolderDropdownOpen(false)
                      }}
                    >
                      {isCurrent && <Check size={10} strokeWidth={2} aria-hidden="true" />}
                      <span>{name}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
        <button
          className="sidebar-branch-trigger"
          onClick={handleToggleDropdown}
          aria-expanded={dropdownOpen}
          aria-label="Switch git branch"
          disabled={loading}
        >
          <GitBranch size={12} strokeWidth={1.8} aria-hidden="true" />
          <span className={`sidebar-branch-trigger-name${detached ? ' sidebar-branch-trigger-name--detached' : ''}`}>
            {loading ? 'Loading...' : currentBranch}
            {detached && ' (detached)'}
          </span>
          <ChevronDown
            className={`sidebar-branch-trigger-chevron${dropdownOpen ? ' sidebar-branch-trigger-chevron--open' : ''}`}
            size={10}
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </button>
      </div>

      {error && <div className="sidebar-branch-error">{error}</div>}

      {dropdownOpen && (
        <div className="sidebar-branch-popover" role="dialog" aria-label="Branch manager">
          {/* Header */}
          <div className="sidebar-branch-popover-header">
            <div className="sidebar-branch-popover-current">
              <GitBranch size={12} strokeWidth={1.8} aria-hidden="true" />
              <span className="sidebar-branch-popover-current-name">{currentBranch}</span>
              <span className="sidebar-branch-popover-current-badge">Current</span>
            </div>
            <button
              className="sidebar-branch-popover-close-btn"
              onClick={() => setDropdownOpen(false)}
              aria-label="Close"
              title="Close"
            >
              <X size={12} strokeWidth={1.8} />
            </button>
          </div>

          {/* Create branch — always visible */}
          <div className="sidebar-branch-popover-section">
            <span className="sidebar-branch-popover-section-label">Create branch</span>
            <div className="sidebar-branch-popover-create">
              <input
                ref={createInputRef}
                className="sidebar-branch-popover-input"
                type="text"
                placeholder="feature/new-branch"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newBranchName.trim()) {
                    e.preventDefault()
                    void handleCreateBranch()
                  }
                }}
                disabled={loading}
              />
              <button
                className="sidebar-branch-popover-create-btn"
                onClick={() => void handleCreateBranch()}
                disabled={!newBranchName.trim() || loading}
              >
                <Plus size={11} strokeWidth={1.8} />
                Create
              </button>
            </div>
          </div>

          {/* Find branch — always visible */}
          <div className="sidebar-branch-popover-section">
            <span className="sidebar-branch-popover-section-label">Find branch</span>
            <div className="sidebar-branch-popover-search">
              <Search size={12} strokeWidth={1.5} className="sidebar-branch-popover-search-icon" aria-hidden="true" />
              <input
                className="sidebar-branch-popover-search-input"
                type="text"
                placeholder="Search by branch name"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    if (searchQuery) {
                      setSearchQuery('')
                    } else {
                      setDropdownOpen(false)
                    }
                  }
                }}
                disabled={loading}
              />
            </div>
          </div>

          {/* Branch list */}
          <div className="sidebar-branch-popover-list-header">
            <span>Branches</span>
            <span>{filteredBranches.length}</span>
          </div>
          <div className="sidebar-branch-popover-list" role="listbox" aria-label="Branches">
            {filteredBranches.length === 0 ? (
              <div className="sidebar-branch-popover-empty">
                {searchQuery ? `No branches match "${searchQuery}"` : 'No branches found'}
              </div>
            ) : (
              filteredBranches.map((branch) => (
                <div key={branch} className={`sidebar-branch-popover-item${branch === currentBranch ? ' sidebar-branch-popover-item--current' : ''}`} role="option" aria-selected={branch === currentBranch}>
                  <button
                    className="sidebar-branch-popover-item-btn"
                    onClick={() => {
                      if (branch !== currentBranch) void handleCheckout(branch)
                    }}
                    disabled={loading}
                  >
                    {branch === currentBranch ? (
                      <Check size={11} strokeWidth={2} className="sidebar-branch-popover-item-icon sidebar-branch-popover-item-icon--check" aria-hidden="true" />
                    ) : (
                      <GitBranch size={11} strokeWidth={1.5} className="sidebar-branch-popover-item-icon" aria-hidden="true" />
                    )}
                    <span className="sidebar-branch-popover-item-name">{branch}</span>
                    {branch === currentBranch && (
                      <span className="sidebar-branch-popover-item-badge">current</span>
                    )}
                  </button>
                  {branch !== currentBranch && (
                    <button
                      className="sidebar-branch-popover-delete-btn"
                      onClick={() => void handleDeleteBranch(branch)}
                      aria-label={`Delete branch ${branch}`}
                      title="Delete branch"
                      disabled={loading}
                    >
                      <Trash2 size={10} strokeWidth={1.5} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
