import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { useProjectStore } from '../store/projectStore'
import { splitDisplayPath } from '../utils/gitStatus'
import type { FileSearchResult } from '../../../shared/search'

interface SearchViewProps {
  /** Roots to search. Every folder of a multi-root workspace is included. */
  rootPaths: string[]
}

/** Keystrokes settle before a walk starts; a project-wide walk is not free. */
const SEARCH_DEBOUNCE_MS = 200

export function SearchView({ rootPaths }: SearchViewProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const openFileInEditor = useProjectStore((s) => s.openFileInEditor)
  const [query, setQuery] = useState('')
  // The result carries the query it answers, so "is this stale?" is a
  // comparison rather than a second piece of state to keep in sync.
  const [result, setResult] = useState<
    (FileSearchResult & { query: string; error?: string }) | null
  >(null)
  const trimmed = query.trim()
  // The caller builds this array inline, so its identity changes on every
  // render of the sidebar. Depending on it directly would restart the debounce
  // timer each time anything else up there re-rendered, and a search typed
  // while the status badge is updating would never fire.
  const rootsKey = rootPaths.join('\n')
  const current = result?.query === trimmed ? result : null
  const searching = trimmed !== '' && current === null

  // The view only exists while its tab is selected, so mounting is the moment
  // the user asked to search.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!trimmed) return

    // `cancelled` is what keeps a slow walk for "g" from landing on top of the
    // results for "gitManager" typed a moment later.
    let cancelled = false
    const timer = setTimeout(() => {
      // Everything runs inside the try, not just the await: if the bridge
      // method is missing the call throws synchronously, and a .catch() on the
      // promise would never see it — leaving the view on "Searching..." with no
      // way to tell that anything went wrong.
      void (async () => {
        try {
          const roots = rootsKey.split('\n')
          const results = await Promise.all(
            roots.map((root) => window.electronAPI.fileSearch(root, trimmed))
          )
          if (cancelled) return
          setResult({
            query: trimmed,
            matches: results.flatMap((r) => r.matches),
            truncated: results.some((r) => r.truncated)
          })
        } catch (err) {
          if (cancelled) return
          setResult({
            query: trimmed,
            matches: [],
            truncated: false,
            error: err instanceof Error ? err.message : 'Search failed'
          })
        }
      })()
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, rootsKey])

  const matches = current?.matches ?? []

  return (
    <div className="sidebar-search-view">
      <div className="sidebar-search-field">
        <Search className="sidebar-search-icon" size={14} strokeWidth={1.5} aria-hidden="true" />
        <input
          ref={inputRef}
          className="sidebar-search-input"
          type="text"
          placeholder="Search files by name..."
          aria-label="Search files by name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
        />
        {query && (
          <button
            className="sidebar-search-clear"
            onClick={() => {
              setQuery('')
              inputRef.current?.focus()
            }}
            aria-label="Clear search"
          >
            <X size={12} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="sidebar-search-results">
        {trimmed === '' && (
          <p className="sidebar-search-message">Type to search file names in this project.</p>
        )}
        {searching && <p className="sidebar-search-message">Searching...</p>}
        {current?.error && (
          <p className="sidebar-search-message sidebar-search-message--error">{current.error}</p>
        )}
        {trimmed !== '' && !searching && !current?.error && matches.length === 0 && (
          <p className="sidebar-search-message">No files match “{trimmed}”</p>
        )}

        {matches.length > 0 && (
          <>
            <p className="sidebar-search-count">
              {matches.length} {matches.length === 1 ? 'result' : 'results'}
              {current?.truncated && ' (partial)'}
            </p>
            <ul>
              {matches.map((match) => {
                const { name, dir } = splitDisplayPath(match.relativePath)
                return (
                  <li key={match.path}>
                    <button
                      className="sidebar-search-result"
                      onClick={() => openFileInEditor(match.path)}
                      title={match.path}
                    >
                      <span className="sidebar-search-result-name">{name}</span>
                      {dir && <span className="sidebar-search-result-dir">{dir}</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
