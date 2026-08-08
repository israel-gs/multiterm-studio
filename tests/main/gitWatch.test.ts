/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { isGitSignalPath, isInsideGitDir } from '../../src/shared/gitWatch'

/**
 * The source control view used to go stale after every commit: the watcher
 * ignored .git wholesale, and a commit writes nothing else. These are the paths
 * that have to get through, and the churn that must not.
 */
describe('isGitSignalPath — reports', () => {
  it('a commit moving a branch ref', () => {
    expect(isGitSignalPath('.git/refs/heads/main')).toBe(true)
  })

  it('a branch switch', () => {
    expect(isGitSignalPath('.git/HEAD')).toBe(true)
  })

  it('staging, which rewrites the index', () => {
    expect(isGitSignalPath('.git/index')).toBe(true)
  })

  it('refs collapsed into packed-refs', () => {
    expect(isGitSignalPath('.git/packed-refs')).toBe(true)
  })

  it('a merge or a cherry-pick in progress', () => {
    expect(isGitSignalPath('.git/MERGE_HEAD')).toBe(true)
    expect(isGitSignalPath('.git/CHERRY_PICK_HEAD')).toBe(true)
  })

  it('a repository nested below the watched root', () => {
    expect(isGitSignalPath('packages/app/.git/refs/heads/main')).toBe(true)
  })

  it('a Windows-separated path', () => {
    expect(isGitSignalPath('.git\\refs\\heads\\main')).toBe(true)
  })
})

describe('isGitSignalPath — ignores', () => {
  it('a lock file, which means the write is only half done', () => {
    expect(isGitSignalPath('.git/index.lock')).toBe(false)
    expect(isGitSignalPath('.git/refs/heads/main.lock')).toBe(false)
  })

  it('loose objects, of which a commit writes many', () => {
    expect(isGitSignalPath('.git/objects/ab/cdef123')).toBe(false)
  })

  it('the reflog and other bookkeeping', () => {
    expect(isGitSignalPath('.git/logs/HEAD')).toBe(false)
    expect(isGitSignalPath('.git/COMMIT_EDITMSG')).toBe(false)
    expect(isGitSignalPath('.git/FETCH_HEAD')).toBe(false)
  })

  it('the refs directory itself, with no ref named', () => {
    expect(isGitSignalPath('.git/refs')).toBe(false)
  })

  it('an ordinary source file', () => {
    expect(isGitSignalPath('src/main/index.ts')).toBe(false)
  })

  it('a file that merely mentions git in its name', () => {
    expect(isGitSignalPath('.gitignore')).toBe(false)
    expect(isGitSignalPath('src/gitManager.ts')).toBe(false)
  })
})

describe('isInsideGitDir', () => {
  it('covers the noise as well as the signal, so the file tree can skip it all', () => {
    expect(isInsideGitDir('.git/objects/ab/cdef123')).toBe(true)
    expect(isInsideGitDir('.git/HEAD')).toBe(true)
    expect(isInsideGitDir('packages/app/.git/index')).toBe(true)
  })

  it('leaves ordinary files alone', () => {
    expect(isInsideGitDir('.gitignore')).toBe(false)
    expect(isInsideGitDir('src/index.ts')).toBe(false)
  })
})
