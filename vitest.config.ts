import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Without the React plugin, esbuild compiles JSX with the classic runtime and
  // every test file needs `import React` in scope — unlike the real build,
  // which uses the automatic runtime via tsconfig's "jsx": "react-jsx".
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
