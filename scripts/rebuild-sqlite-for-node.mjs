#!/usr/bin/env node
/**
 * Rebuilds better-sqlite3 for the current Node.js ABI when it was previously
 * compiled against the Electron ABI (which happens after `postinstall` runs
 * `electron-builder install-app-deps`).
 *
 * Strategy:
 *   1. Try to require() better-sqlite3 in a child process — if that succeeds,
 *      the module is already compatible with this Node and we skip the rebuild.
 *   2. On failure, run `npm rebuild better-sqlite3 --build-from-source` which
 *      uses node-gyp under the hood and produces a Node-compatible binary.
 *
 * The check+rebuild is idempotent: running it when the binary is already Node-
 * compatible is a no-op (exits quickly at step 1).
 */

import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function log(msg) {
  process.stdout.write(`[rebuild-sqlite] ${msg}\n`)
}

// ── Check ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function isNodeAbiReady() {
  // Spawn a fresh Node process to require() better-sqlite3.  We must use a
  // child process (not a dynamic import here) because a prior failed require
  // would be cached in the module registry and always throw.
  const result = spawnSync(process.execPath, ['-e', "require('better-sqlite3')"], {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  return result.status === 0
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (isNodeAbiReady()) {
  log('node ABI ready — skipping rebuild')
  process.exit(0)
}

log('rebuilding better-sqlite3 for Node ABI…')

try {
  execSync('npm rebuild better-sqlite3 --build-from-source', {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  log('rebuild complete — node ABI ready')
} catch (err) {
  process.stderr.write(`[rebuild-sqlite] rebuild failed: ${err.message}\n`)
  process.exit(1)
}
