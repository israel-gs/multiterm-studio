import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * INFRA-05: Dark theme styling (background #1a1a1a, panels #242424, headers #2e2e2e)
 *
 * Static verification: reads global.css as text and asserts the required
 * CSS custom properties are defined with the correct values.
 */
describe('Dark theme CSS custom properties (INFRA-05)', () => {
  const css = readFileSync(
    resolve(__dirname, '../../src/renderer/src/assets/global.css'),
    'utf-8'
  )

  test('--bg-main is defined as #1a1a1a', () => {
    expect(css).toContain('--bg-main: #1a1a1a')
  })

  test('--bg-panel is defined as #242424', () => {
    expect(css).toContain('--bg-panel: #242424')
  })

  test('--bg-header is defined as #2e2e2e', () => {
    expect(css).toContain('--bg-header: #2e2e2e')
  })

  test('--fg-primary is defined as #d4d4d4', () => {
    expect(css).toContain('--fg-primary: #d4d4d4')
  })

  test('--fg-secondary is defined as #808080', () => {
    expect(css).toContain('--fg-secondary: #808080')
  })

  test('body has overflow: hidden', () => {
    expect(css).toContain('overflow: hidden')
  })

  test('body has margin: 0', () => {
    expect(css).toContain('margin: 0')
  })
})
