import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * A maximized tile is portalled to document.body and positioned fixed, so it is
 * outside the layout flow that keeps the sidebars clear. It has to inset itself
 * from both edges, and only the CSS says so — hence a static check.
 */
describe('maximized tile insets', () => {
  const css = readFileSync(resolve(__dirname, '../../src/renderer/src/assets/global.css'), 'utf-8')
  const rule = css.slice(
    css.indexOf('.floating-card--maximized {'),
    css.indexOf('}', css.indexOf('.floating-card--maximized {'))
  )

  it('leaves room for the left sidebar', () => {
    expect(rule).toContain('left: var(--sidebar-width, 0px)')
  })

  it('leaves room for the tile index on the right', () => {
    expect(rule).toContain('right: var(--tile-index-width, 0px)')
  })

  it('drops the focus ring and the drop shadow', () => {
    // Both live in box-shadow, so overriding `border` alone left purple lines
    // down the edges where the tile meets the sidebars.
    expect(rule).toContain('box-shadow: none !important')
  })

  it('draws the edges that meet the sidebars', () => {
    // It paints over the 1px resize handles that normally separate them.
    expect(rule).toContain('border-left: 1px solid var(--border-subtle)')
    expect(rule).toContain('border-right: 1px solid var(--border-subtle)')
  })

  it('hides the resize handles, which cannot do anything when maximized', () => {
    expect(css).toContain('.floating-card--maximized .resize-handle {')
  })

  it('defines both widths as custom properties with a default', () => {
    expect(css).toContain('--sidebar-width: 300px')
    expect(css).toContain('--tile-index-width: 260px')
  })
})
