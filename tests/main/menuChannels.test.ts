/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * The menu talks to the renderer over `menu:*` channels, and the preload only
 * forwards the ones named in a hardcoded list. A menu item whose channel is
 * missing from that list looks wired but silently does nothing — which is
 * exactly how the tile index shortcut shipped broken.
 */

const root = join(__dirname, '../..')
const mainSource = readFileSync(join(root, 'src/main/index.ts'), 'utf-8')
const preloadSource = readFileSync(join(root, 'src/preload/index.ts'), 'utf-8')

/** Channels the menu actually sends. */
const sent = [...mainSource.matchAll(/sendToRenderer\('(menu:[^']+)'\)/g)].map((m) => m[1])

/** Channels the preload subscribes to, from the onMenuAction list. */
const forwarded = (() => {
  const start = preloadSource.indexOf('onMenuAction')
  const end = preloadSource.indexOf(']', start)
  return [...preloadSource.slice(start, end).matchAll(/'(menu:[^']+)'/g)].map((m) => m[1])
})()

describe('menu channels', () => {
  it('finds channels on both sides, so the parsing still matches the source', () => {
    expect(sent.length).toBeGreaterThan(5)
    expect(forwarded.length).toBeGreaterThan(5)
  })

  it('forwards every channel the menu sends', () => {
    const dropped = sent.filter((channel) => !forwarded.includes(channel))

    expect(dropped).toEqual([])
  })

  it('does not forward a channel nothing sends', () => {
    const orphans = forwarded.filter((channel) => !sent.includes(channel))

    expect(orphans).toEqual([])
  })
})
