import { chmodSync, mkdirSync } from 'fs'
import { dirname } from 'path'

/**
 * Unix-domain sockets under ~/.multiterm-studio give whoever can connect the
 * ability to write into a PTY (i.e. run commands as this user), so every
 * directory and socket we create must be restricted to the owner.
 *
 * On Windows the paths are named pipes and these calls do not apply.
 */

const isWindows = process.platform === 'win32'

/** Creates the parent directory of `filePath` with owner-only permissions. */
export function ensureSecureDir(filePath: string): void {
  if (isWindows) return
  const dir = dirname(filePath)
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {
    // ignore — the socket bind below will surface any real problem
  }
  // mkdir's `mode` is masked by umask and is a no-op when the directory already
  // exists, so tighten it explicitly.
  try {
    chmodSync(dir, 0o700)
  } catch {
    // ignore
  }
}

/** Restricts an already-bound socket file to owner-only read/write. */
export function secureSocketFile(socketPath: string): void {
  if (isWindows) return
  try {
    chmodSync(socketPath, 0o600)
  } catch {
    // ignore
  }
}
