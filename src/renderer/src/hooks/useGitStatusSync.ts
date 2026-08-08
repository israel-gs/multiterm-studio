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
 * Mount it exactly once per window; two callers would double every read.
 */
export function useGitStatusSync(folderPath: string): void {
  const isRepo = useGitStore((s) => s.isRepo)
  const refreshStatus = useGitStore((s) => s.refreshStatus)
  const scheduleStatusRefresh = useGitStore((s) => s.scheduleStatusRefresh)
  const clearStatus = useGitStore((s) => s.clearStatus)
  const fsRefreshKey = useProjectStore((s) => s.fsRefreshKey)

  // The first read of a folder is immediate; changing folders also drops the
  // previous repo's list so it cannot linger under the new project's name.
  useEffect(() => {
    if (!isRepo) {
      clearStatus()
      return
    }
    void refreshStatus(folderPath)
  }, [folderPath, isRepo, refreshStatus, clearStatus])

  // Later reads ride the file watcher, debounced: a build touching a thousand
  // files must cost one `git status`, not a thousand.
  useEffect(() => {
    if (!isRepo || fsRefreshKey === 0) return
    scheduleStatusRefresh(folderPath)
  }, [fsRefreshKey, folderPath, isRepo, scheduleStatusRefresh])
}
