import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { SIDECAR_CONTROL_ENDPOINT, SIDECAR_PID_PATH } from './protocol'
import { SidecarServer } from './server'

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const server = new SidecarServer({ controlEndpoint: SIDECAR_CONTROL_ENDPOINT })

async function start(): Promise<void> {
  await server.listen()

  // Write PID file so the parent process can track us
  try {
    mkdirSync(dirname(SIDECAR_PID_PATH), { recursive: true })
    writeFileSync(SIDECAR_PID_PATH, String(process.pid), { encoding: 'utf8' })
  } catch (err) {
    process.stderr.write(`[sidecar] Failed to write PID file: ${(err as Error).message}\n`)
  }

  process.stdout.write(`[sidecar] Listening on ${SIDECAR_CONTROL_ENDPOINT}\n`)
}

async function shutdown(): Promise<void> {
  process.stdout.write('[sidecar] Shutting down...\n')

  try {
    await server.close()
  } catch (err) {
    process.stderr.write(`[sidecar] Error during close: ${(err as Error).message}\n`)
  }

  // Remove PID file
  try {
    if (existsSync(SIDECAR_PID_PATH)) {
      unlinkSync(SIDECAR_PID_PATH)
    }
  } catch {
    // ignore
  }

  process.stdout.write('[sidecar] Shutdown complete.\n')
  process.exit(0)
}

// ── Signal handling ───────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  shutdown().catch((err) => {
    process.stderr.write(`[sidecar] Shutdown error: ${(err as Error).message}\n`)
    process.exit(1)
  })
})

process.on('SIGINT', () => {
  shutdown().catch((err) => {
    process.stderr.write(`[sidecar] Shutdown error: ${(err as Error).message}\n`)
    process.exit(1)
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

start().catch((err) => {
  process.stderr.write(`[sidecar] Fatal startup error: ${(err as Error).message}\n`)
  process.exit(1)
})
