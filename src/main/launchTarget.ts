import { existsSync, statSync } from 'fs'
import { isAbsolute, resolve } from 'path'

/**
 * Resolves the folder or workspace file the app was asked to open.
 *
 * The `multiterm` CLI launches the app as `open -a "Multiterm Studio" --args
 * <dir>`, and macOS can hand us a path when a .multiterm-workspace file is
 * double-clicked. Electron also passes its own switches in argv, so anything
 * that is not an existing path is ignored.
 */
export function launchTargetFromArgv(argv: string[], cwd: string = process.cwd()): string | null {
  // Skip argv[0] (the executable). In dev, argv[1] is the app bundle path.
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue
    const candidate = isAbsolute(arg) ? arg : resolve(cwd, arg)
    if (!existsSync(candidate)) continue
    try {
      const stats = statSync(candidate)
      if (stats.isDirectory()) return candidate
      if (stats.isFile() && isWorkspaceFile(candidate)) return candidate
    } catch {
      // unreadable — keep looking
    }
  }
  return null
}

/** True for the workspace file types the app knows how to open. */
export function isWorkspaceFile(filePath: string): boolean {
  return filePath.endsWith('.multiterm-workspace') || filePath.endsWith('.code-workspace')
}
