import { useEffect } from 'react'
import { useGitStore } from '../store/gitStore'
import { useProjectStore } from '../store/projectStore'

/**
 * Keeps the working-tree status in the store fresh for `folderPath`.
 *
 * This lives apart from the view that renders the file list because the count
 * badge on the Source Control tab has to be right while the file tree is the
 * visible view — the status cannot be tied to the lifetime of a panel that is
 * unmounted most of the time.
 *
 * It also owns reacting to repository changes, which arrive on their own channel
 * because a commit touches nothing but .git.
 *
 * Mount it exactly once per window; two callers would double every read.
 */
export function useGitStatusSync(folderPath: string): void {
  const isRepo = useGitStore((s) => s.isRepo)
  const refreshStatus = useGitStore((s) => s.refreshStatus)
  const loadCommits = useGitStore((s) => s.loadCommits)
  const scheduleStatusRefresh = useGitStore((s) => s.scheduleStatusRefresh)
  const scheduleGitRefresh = useGitStore((s) => s.scheduleGitRefresh)
  const clearStatus = useGitStore((s) => s.clearStatus)
  const fsRefreshKey = useProjectStore((s) => s.fsRefreshKey)
  const gitRefreshKey = useProjectStore((s) => s.gitRefreshKey)

  // The first read of a folder is immediate; changing folders also drops the
  // previous repo's list so it cannot linger under the new project's name.
  useEffect(() => {
    if (!isRepo) {
      clearStatus()
      return
    }
    void refreshStatus(folderPath)
    // History only changes when commits are made, so it is read once per folder
    // rather than on every watcher tick like the status.
    void loadCommits(folderPath)
  }, [folderPath, isRepo, refreshStatus, loadCommits, clearStatus])

  // Later reads ride the file watcher, debounced: a build touching a thousand
  // files must cost one `git status`, not a thousand.
  useEffect(() => {
    if (!isRepo || fsRefreshKey === 0) return
    scheduleStatusRefresh(folderPath)
  }, [fsRefreshKey, folderPath, isRepo, scheduleStatusRefresh])

  // A change inside .git means the history moved too, so both are re-read.
  useEffect(() => {
    if (!isRepo || gitRefreshKey === 0) return
    scheduleGitRefresh(folderPath)
  }, [gitRefreshKey, folderPath, isRepo, scheduleGitRefresh])
}
