#!/usr/bin/env node
/**
 * Post-install steps.
 *
 * 1. `electron-builder install-app-deps` — rebuild native modules (node-pty).
 * 2. macOS only: rename the dev Electron.app bundle so the menu bar and the
 *    dock say "Multiterm Studio" instead of "Electron" during `pnpm dev`.
 *
 * Step 2 used to be an inline `sed -i ''`, which is BSD-specific: it failed the
 * whole install on Linux and Windows (and therefore in CI).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const APP_NAME = 'Multiterm Studio'
const INFO_PLIST = 'node_modules/electron/dist/Electron.app/Contents/Info.plist'

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

run('electron-builder', ['install-app-deps'])

if (process.platform === 'darwin' && existsSync(INFO_PLIST)) {
  try {
    const plist = readFileSync(INFO_PLIST, 'utf-8')
    const renamed = plist.replaceAll('<string>Electron</string>', `<string>${APP_NAME}</string>`)
    if (renamed !== plist) {
      writeFileSync(INFO_PLIST, renamed)
    }
  } catch (err) {
    // Cosmetic only — never fail the install over it.
    console.warn(`[postinstall] could not rename the dev Electron bundle: ${err.message}`)
  }
}
