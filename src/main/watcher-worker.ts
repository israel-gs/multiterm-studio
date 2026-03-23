import { subscribe, type AsyncSubscription, type Event } from '@parcel/watcher'
import { dirname, relative } from 'path'

const IGNORE_PATTERNS = [
  '**/.git/**',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/node_modules/**',
  '**/bower_components/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.next/**',
  '**/.cache/**',
  '**/__pycache__/**',
  '**/.multiterm/**',
  '**/.claude/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map'
]

let subscription: AsyncSubscription | null = null

async function startWatching(folderPath: string): Promise<void> {
  if (subscription) await subscription.unsubscribe()

  subscription = await subscribe(
    folderPath,
    (err, events) => {
      if (err) {
        process.parentPort!.postMessage({ type: 'error', error: String(err) })
        return
      }

      const changes = events.map((e: Event) => ({
        path: e.path,
        relativePath: relative(folderPath, e.path),
        type: e.type
      }))

      if (changes.length > 0) {
        process.parentPort!.postMessage({ type: 'changes', changes })
      }
    },
    { ignore: IGNORE_PATTERNS }
  )
}

async function stopWatching(): Promise<void> {
  if (subscription) {
    await subscription.unsubscribe()
    subscription = null
  }
}

process.parentPort!.on('message', (e: MessageEvent) => {
  const msg = e.data as { type: string; folderPath?: string }
  if (msg.type === 'start' && msg.folderPath) {
    startWatching(msg.folderPath).catch((err) => {
      process.parentPort!.postMessage({ type: 'error', error: String(err) })
    })
  } else if (msg.type === 'stop') {
    stopWatching()
  }
})
