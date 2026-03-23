import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import monacoEditorPlugin from 'vite-plugin-monaco-editor'

const monacoPlugin = (monacoEditorPlugin as unknown as { default: typeof monacoEditorPlugin })
  .default || monacoEditorPlugin

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['node-pty', '@parcel/watcher'],
        input: {
          index: resolve('src/main/index.ts'),
          'watcher-worker': resolve('src/main/watcher-worker.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['node-pty']
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [
      react(),
      monacoPlugin({
        languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html']
      })
    ]
  }
})
