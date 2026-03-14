import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  }
})
