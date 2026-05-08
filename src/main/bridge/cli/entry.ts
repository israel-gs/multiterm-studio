/**
 * CLI entry point — thin wrapper around `run()` that wires real deps and exits.
 *
 * Bundled by electron-vite as `out/main/cli-entry.js` (CJS).
 * The shell launcher installed by cliInstaller.ts execs this file via Node.
 */

import { createConnection } from 'net'
import { run, type CliDeps } from './index'

// ── Real deps ─────────────────────────────────────────────────────────────────

// Single-use connection shared between connect() and call().
// Because the CLI sends exactly one request and exits, a shared singleton
// is sufficient — no pooling required.
let sock: ReturnType<typeof createConnection> | null = null
let readBuf = ''

const defaultDeps: CliDeps = {
  connect(endpoint: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const s = createConnection(endpoint)
      sock = s
      s.setEncoding('utf8')
      s.on('connect', () => resolve())
      s.on('error', reject)
    })
  },

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (!sock) {
        reject(new Error('Not connected'))
        return
      }

      const id = 1
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'

      sock.on('data', (chunk: string) => {
        readBuf += chunk
        const lines = readBuf.split('\n')
        readBuf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const parsed = JSON.parse(trimmed) as {
              error?: { code: number; message: string }
              result?: unknown
            }
            if (parsed.error) {
              reject(parsed.error)
            } else {
              resolve(parsed.result)
            }
          } catch {
            reject(new Error(`Malformed response: ${trimmed}`))
          }
          // Close after first response — CLI is one-shot.
          sock?.destroy()
        }
      })

      sock.write(msg)
    })
  },

  log(msg: string): void {
    process.stdout.write(msg + '\n')
  },

  errlog(msg: string): void {
    process.stderr.write(msg + '\n')
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────

run(process.argv.slice(2), process.env, defaultDeps).then((code) => {
  // Ensure the socket is closed before exit so Node doesn't hang.
  try {
    sock?.destroy()
  } catch {
    /* ignore */
  }
  process.exit(code)
})

// Satisfy the module system: entry.ts does not export anything for consumers.
export {}
