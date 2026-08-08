/** Types shared by the file-search handler and the sidebar view that calls it. */

export interface FileSearchMatch {
  /** Absolute path, ready to open. */
  path: string
  /** Path relative to the searched root, forward-slashed. */
  relativePath: string
}

export interface FileSearchResult {
  matches: FileSearchMatch[]
  /** True when the walk hit a limit, so the list is not the whole truth. */
  truncated: boolean
}

/** Matches returned per query. Beyond this the list stops being scannable. */
export const FILE_SEARCH_MAX_RESULTS = 200

/** Directory names never worth walking into for a filename search. */
export const FILE_SEARCH_IGNORED_DIRS: readonly string[] = ['node_modules', '.git']
