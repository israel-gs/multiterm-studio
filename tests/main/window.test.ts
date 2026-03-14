import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * INFRA-01: BrowserWindow config uses contextIsolation:true and nodeIntegration:false
 *
 * Static verification: reads src/main/index.ts as text and asserts the required
 * webPreferences are present. This avoids the complexity of mocking all of Electron.
 */
describe('BrowserWindow security configuration (INFRA-01)', () => {
  const source = readFileSync(resolve(__dirname, '../../src/main/index.ts'), 'utf-8')

  test('contextIsolation is set to true', () => {
    expect(source).toContain('contextIsolation: true')
  })

  test('nodeIntegration is set to false', () => {
    expect(source).toContain('nodeIntegration: false')
  })

  test('sandbox is set to false (required for preload Node APIs)', () => {
    expect(source).toContain('sandbox: false')
  })

  test('preload path is configured', () => {
    expect(source).toMatch(/preload.*join.*__dirname.*preload.*index\.js/)
  })
})
