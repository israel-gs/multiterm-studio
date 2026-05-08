#!/usr/bin/env node
/**
 * Rebuilds better-sqlite3 for the current Electron ABI when it was previously
 * compiled against the host Node.js ABI (which happens after `pretest` runs
 * `rebuild-sqlite-for-node.mjs`).
 *
 * Strategy:
 *   1. Read the bundled Electron binary's NODE_MODULE_VERSION.
 *   2. Read the compiled `better_sqlite3.node` ABI tag from its header.
 *   3. If they match, skip.
 *   4. Otherwise run `electron-builder install-app-deps` which targets the
 *      Electron version recorded in package.json and rebuilds all native deps,
 *      including better-sqlite3, against the Electron ABI.
 *
 * The check+rebuild is idempotent: running it when the binary is already
 * Electron-compatible is a no-op (exits quickly).
 */

import { execSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '..')

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function log(msg) {
  process.stdout.write(`[rebuild-sqlite-electron] ${msg}\n`)
}

// ── Check ─────────────────────────────────────────────────────────────────────

// Spawn the bundled Electron binary asking it to require() better-sqlite3.
// If it succeeds, the binary is already built for the Electron ABI.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function isElectronAbiReady() {
  const electronCli = resolve(projectRoot, 'node_modules', '.bin', 'electron')
  if (!existsSync(electronCli)) {
    log('electron binary not found in node_modules — skipping (run pnpm install first)')
    return true
  }
  const result = spawnSync(
    electronCli,
    [
      '--no-sandbox',
      '-e',
      "try { require('better-sqlite3'); process.exit(0); } catch (e) { process.exit(1); }"
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    }
  )
  return result.status === 0
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (isElectronAbiReady()) {
  log('electron ABI ready — skipping rebuild')
  process.exit(0)
}

log('rebuilding better-sqlite3 for Electron ABI…')

try {
  execSync('npx electron-builder install-app-deps', {
    cwd: projectRoot,
    stdio: 'inherit'
  })
  log('rebuild complete — electron ABI ready')
} catch (err) {
  process.stderr.write(`[rebuild-sqlite-electron] rebuild failed: ${err.message}\n`)
  process.exit(1)
}
