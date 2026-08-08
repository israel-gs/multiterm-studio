/** @vitest-environment node */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { searchFiles } from '../../src/main/folderManager'

/**
 * Exercised against a real directory tree: what makes this function correct is
 * where it refuses to walk (node_modules, .git, symlinks that loop) and how it
 * orders what it finds.
 */

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'mts-search-'))
  mkdirSync(join(root, 'src', 'main'), { recursive: true })
  mkdirSync(join(root, 'src', 'renderer'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'react'), { recursive: true })
  mkdirSync(join(root, '.git', 'refs'), { recursive: true })

  writeFileSync(join(root, 'README.md'), '')
  writeFileSync(join(root, 'gitignore-sample.txt'), '')
  writeFileSync(join(root, 'src', 'main', 'gitManager.ts'), '')
  writeFileSync(join(root, 'src', 'main', 'index.ts'), '')
  writeFileSync(join(root, 'src', 'renderer', 'index.tsx'), '')
  writeFileSync(join(root, 'src', 'legitimate.ts'), '')
  writeFileSync(join(root, 'node_modules', 'react', 'index.js'), '')
  writeFileSync(join(root, '.git', 'refs', 'index.txt'), '')

  // A link back to the root: following it would make the walk loop forever.
  symlinkSync(root, join(root, 'self-link'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('searchFiles', () => {
  it('finds a file anywhere in the tree, however deep', async () => {
    const { matches } = await searchFiles(root, 'gitManager')

    expect(matches.map((m) => m.relativePath)).toEqual(['src/main/gitManager.ts'])
  })

  it('matches case-insensitively', async () => {
    const { matches } = await searchFiles(root, 'READme')

    expect(matches.map((m) => m.relativePath)).toContain('README.md')
  })

  it('returns absolute paths ready to open', async () => {
    const { matches } = await searchFiles(root, 'gitManager')

    expect(matches[0].path).toBe(join(root, 'src', 'main', 'gitManager.ts'))
  })

  it('never walks into node_modules or .git', async () => {
    const { matches } = await searchFiles(root, 'index')
    const paths = matches.map((m) => m.relativePath)

    expect(paths).toContain('src/main/index.ts')
    expect(paths).toContain('src/renderer/index.tsx')
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false)
  })

  it('does not follow a symlink that points back up the tree', async () => {
    const { matches } = await searchFiles(root, 'README')

    // Following self-link would yield self-link/README.md as well.
    expect(matches).toHaveLength(1)
  })

  it('matches against the whole relative path when the query has a slash', async () => {
    const { matches } = await searchFiles(root, 'main/index')

    expect(matches.map((m) => m.relativePath)).toEqual(['src/main/index.ts'])
  })

  it('does not match a directory name when the query has no slash', async () => {
    // "main" is a directory here; matching it would return every file under it.
    const { matches } = await searchFiles(root, 'main')

    expect(matches.map((m) => m.relativePath)).not.toContain('src/main/index.ts')
  })

  it('ranks a name that starts with the query above one that merely contains it', async () => {
    const { matches } = await searchFiles(root, 'git')
    const paths = matches.map((m) => m.relativePath)

    expect(paths.indexOf('gitignore-sample.txt')).toBeLessThan(
      paths.indexOf('src/main/gitManager.ts')
    )
  })

  it('ranks shallower paths first among equally good names', async () => {
    const { matches } = await searchFiles(root, '.ts')
    const depths = matches.map((m) => m.relativePath.split('/').length)

    expect(depths).toEqual([...depths].sort((a, b) => a - b))
  })

  it('returns nothing for a blank query instead of the whole tree', async () => {
    expect(await searchFiles(root, '   ')).toEqual({ matches: [], truncated: false })
  })

  it('reports no match rather than failing', async () => {
    const { matches, truncated } = await searchFiles(root, 'nothing-named-like-this')

    expect(matches).toEqual([])
    expect(truncated).toBe(false)
  })

  it('reports a missing root as an empty result', async () => {
    const { matches } = await searchFiles(join(root, 'does-not-exist'), 'index')

    expect(matches).toEqual([])
  })
})
