import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CLI_DIR = join(homedir(), '.local', 'bin')
const CLI_PATH = join(CLI_DIR, 'multiterm')

const SCRIPT = `#!/bin/sh
# Multiterm Studio CLI launcher
# Opens the given directory (or current directory) in Multiterm Studio

DIR="\${1:-.}"
DIR="$(cd "$DIR" 2>/dev/null && pwd || echo "$DIR")"

if [ "$(uname)" = "Darwin" ]; then
  open -a "Multiterm Studio" --args "$DIR"
else
  echo "Unsupported platform" >&2
  exit 1
fi
`

export function installCli(): void {
  try {
    if (process.platform !== 'darwin') return
    if (existsSync(CLI_PATH)) return

    mkdirSync(CLI_DIR, { recursive: true })
    writeFileSync(CLI_PATH, SCRIPT, 'utf-8')
    chmodSync(CLI_PATH, 0o755)

    const pathEnv = process.env.PATH ?? ''
    if (!pathEnv.includes('.local/bin')) {
      console.log(
        '[cli-installer] multiterm installed at ~/.local/bin/multiterm. ' +
          'Add ~/.local/bin to your PATH if not already present.'
      )
    }
  } catch {
    // Silent failure — CLI install is best-effort
  }
}
