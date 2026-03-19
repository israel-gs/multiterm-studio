import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * INFRA-05: Dark theme styling
 * Canvas #111, cards #1c1c1c, headers #2a2a2a (updated for infinite canvas redesign)
 *
 * Static verification: reads global.css as text and asserts the required
 * CSS custom properties are defined with the correct values.
 */
describe('Dark theme CSS custom properties (INFRA-05)', () => {
  const css = readFileSync(
    resolve(__dirname, '../../src/renderer/src/assets/global.css'),
    'utf-8'
  )

  test('--bg-canvas is defined as #111', () => {
    expect(css).toContain('--bg-canvas: #111')
  })

  test('--bg-card is defined as #1c1c1c', () => {
    expect(css).toContain('--bg-card: #1c1c1c')
  })

  test('--bg-header is defined as #2a2a2a', () => {
    expect(css).toContain('--bg-header: #2a2a2a')
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
