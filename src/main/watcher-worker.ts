import { subscribe, type AsyncSubscription, type Event } from '@parcel/watcher'
import { relative } from 'path'

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

const subscriptions = new Map<string, AsyncSubscription>()

function subscribeFolder(folderPath: string): Promise<void> {
  return subscribe(
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
  ).then((sub) => {
    subscriptions.set(folderPath, sub)
  })
}

async function stopAll(): Promise<void> {
  for (const [, sub] of subscriptions) {
    await sub.unsubscribe()
  }
  subscriptions.clear()
}

async function startWatching(folderPath: string): Promise<void> {
  await stopAll()
  await subscribeFolder(folderPath)
}

async function startWatchingMulti(folderPaths: string[]): Promise<void> {
  await stopAll()
  await Promise.all(folderPaths.map((fp) => subscribeFolder(fp)))
}

process.parentPort!.on('message', (e: { data: unknown }) => {
  const msg = e.data as { type: string; folderPath?: string; folderPaths?: string[] }
  if (msg.type === 'start' && msg.folderPath) {
    startWatching(msg.folderPath).catch((err) => {
      process.parentPort!.postMessage({ type: 'error', error: String(err) })
    })
  } else if (msg.type === 'start-multi' && msg.folderPaths) {
    startWatchingMulti(msg.folderPaths).catch((err) => {
      process.parentPort!.postMessage({ type: 'error', error: String(err) })
    })
  } else if (msg.type === 'stop') {
    stopAll()
  }
})
