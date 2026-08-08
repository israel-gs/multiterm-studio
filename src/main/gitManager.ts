import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { readFile, stat } from 'fs/promises'
import { isAbsolute, join, relative, resolve as resolvePath, sep } from 'path'
import { isPathInsideRoots } from './pathGuard'
import {
  GIT_LOG_PAGE_SIZE,
  GIT_MAX_DIFF_BYTES,
  type GitCommit,
  type GitCommitDetailResult,
  type GitCommitFile,
  type GitCommitFileStatus,
  type GitDiffResult,
  type GitLogResult,
  type GitRef,
  type GitFileState,
  type GitFileStatus,
  type GitStatus,
  type GitStatusResult
} from '../shared/git'

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: STATUS_MAX_BUFFER }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr })
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

/**
 * A repository with tens of thousands of untracked paths blows past the 1 MB
 * execFile default, and the failure looks like "git is broken" rather than
 * "the output was long".
 */
const STATUS_MAX_BUFFER = 64 * 1024 * 1024

/** How much of a blob we sniff for NUL bytes before calling it binary. */
const BINARY_SNIFF_BYTES = 8000

function errorMessage(err: unknown, fallback: string): string {
  const stderr = (err as { stderr?: string } | undefined)?.stderr
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  const message = (err as { error?: { message?: string } } | undefined)?.error?.message
  return message ?? fallback
}

let gitHandlersRegistered = false

export function registerGitHandlers(): void {
  if (gitHandlersRegistered) return
  gitHandlersRegistered = true
  ipcMain.handle('git:is-repo', async (_event, folderPath: string) => {
    try {
      await runGit(['rev-parse', '--is-inside-work-tree'], folderPath)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'git:branches',
    async (
      _event,
      folderPath: string
    ): Promise<{ current: string; branches: string[]; detached: boolean }> => {
      const [headResult, branchResult] = await Promise.all([
        runGit(['rev-parse', '--abbrev-ref', 'HEAD'], folderPath),
        runGit(['branch', '--list', '--no-color'], folderPath)
      ])

      const current = headResult.stdout.trim()
      const detached = current === 'HEAD'

      const branches = branchResult.stdout
        .split('\n')
        .map((line) => line.replace(/^\*?\s+/, '').trim())
        .filter(Boolean)

      return { current, branches, detached }
    }
  )

  ipcMain.handle(
    'git:checkout',
    async (
      _event,
      folderPath: string,
      branch: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        await runGit(['checkout', '--end-of-options', branch], folderPath)
        return { ok: true }
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? 'Checkout failed'
        return { ok: false, error: stderr }
      }
    }
  )

  ipcMain.handle(
    'git:create-branch',
    async (
      _event,
      folderPath: string,
      branchName: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        await runGit(['branch', '--end-of-options', branchName], folderPath)
        await runGit(['checkout', '--end-of-options', branchName], folderPath)
        return { ok: true }
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? 'Failed to create branch'
        return { ok: false, error: stderr }
      }
    }
  )

  ipcMain.handle(
    'git:delete-branch',
    async (
      _event,
      folderPath: string,
      branchName: string
    ): Promise<{ ok: boolean; error?: string }> => {
      try {
        await runGit(['branch', '-d', '--end-of-options', branchName], folderPath)
        return { ok: true }
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? 'Failed to delete branch'
        return { ok: false, error: stderr }
      }
    }
  )

  ipcMain.handle('git:status', async (_event, folderPath: string): Promise<GitStatusResult> => {
    try {
      // --no-optional-locks keeps a polled status from fighting a git command
      // the user is running in one of the terminals for the index lock.
      const { stdout } = await runGit(
        ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '--branch'],
        folderPath
      )
      return { ok: true, status: parseStatusPorcelainV2(stdout) }
    } catch (err: unknown) {
      return { ok: false, error: errorMessage(err, 'Failed to read status') }
    }
  })

  ipcMain.handle(
    'git:diff',
    async (
      _event,
      folderPath: string,
      filePath: string,
      staged = false,
      sha?: string
    ): Promise<GitDiffResult> => {
      const repoPath = toRepoRelative(folderPath, filePath)
      if (!repoPath) {
        return { ok: false, error: 'Path is outside the project' }
      }
      if (sha !== undefined && !isShaLike(sha)) {
        return { ok: false, error: 'Not a commit id' }
      }

      try {
        // Three comparisons, one handler: a commit against its parent, the
        // index against HEAD, or the file on disk against the index — the last
        // being exactly what `git add` would take.
        const [original, modified] = await Promise.all([
          sha
            ? readBlob(folderPath, `${sha}^:${repoPath}`)
            : staged
              ? readBlob(folderPath, `HEAD:${repoPath}`)
              : readBlob(folderPath, `:${repoPath}`),
          sha
            ? readBlob(folderPath, `${sha}:${repoPath}`)
            : staged
              ? readBlob(folderPath, `:${repoPath}`)
              : readWorktreeFile(join(folderPath, repoPath))
        ])

        const kind =
          original.tooLarge || modified.tooLarge
            ? 'too-large'
            : isBinary(original.data) || isBinary(modified.data)
              ? 'binary'
              : 'text'

        return {
          ok: true,
          diff: {
            path: repoPath,
            original: kind === 'text' ? (original.data?.toString('utf-8') ?? '') : '',
            modified: kind === 'text' ? (modified.data?.toString('utf-8') ?? '') : '',
            kind,
            staged,
            sha
          }
        }
      } catch (err: unknown) {
        return { ok: false, error: errorMessage(err, 'Failed to read diff') }
      }
    }
  )

  ipcMain.handle(
    'git:log',
    async (
      _event,
      folderPath: string,
      limit = GIT_LOG_PAGE_SIZE,
      skip = 0
    ): Promise<GitLogResult> => {
      try {
        const { stdout } = await runGit(
          [
            '--no-optional-locks',
            'log',
            // --all so the graph has branches to draw, --topo-order so a branch
            // reads as one run of commits instead of being interleaved by date.
            '--all',
            '--topo-order',
            `--max-count=${Math.max(1, Math.trunc(limit))}`,
            `--skip=${Math.max(0, Math.trunc(skip))}`,
            `--format=${LOG_FORMAT}`
          ],
          folderPath
        )
        return { ok: true, commits: parseLog(stdout) }
      } catch (err: unknown) {
        return { ok: false, error: errorMessage(err, 'Failed to read history') }
      }
    }
  )

  ipcMain.handle(
    'git:commit-detail',
    async (_event, folderPath: string, sha: string): Promise<GitCommitDetailResult> => {
      if (!isShaLike(sha)) return { ok: false, error: 'Not a commit id' }

      try {
        // --root so the first commit in a repository reports its files rather
        // than nothing, and -z so paths stay verbatim.
        const args = ['--no-optional-locks', 'diff-tree', '--no-commit-id', '-r', '-z', '--root']
        const [nameStatus, numstat] = await Promise.all([
          runGit([...args, '--name-status', sha], folderPath),
          runGit([...args, '--numstat', sha], folderPath)
        ])

        const files = mergeCommitFiles(
          parseNameStatus(nameStatus.stdout),
          parseNumstat(numstat.stdout)
        )

        return {
          ok: true,
          detail: {
            sha,
            files,
            insertions: files.reduce((sum, file) => sum + file.insertions, 0),
            deletions: files.reduce((sum, file) => sum + file.deletions, 0)
          }
        }
      } catch (err: unknown) {
        return { ok: false, error: errorMessage(err, 'Failed to read commit') }
      }
    }
  )
}

/**
 * Unit separator between fields, record separator between commits.
 *
 * A commit body can contain newlines and tabs, so no printable delimiter is
 * safe; these two control characters are the ones git itself suggests for
 * machine-read output.
 */
const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'
const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%P%x1f%D%x1f%s%x1f%b%x1e'

/** Reject anything that is not plausibly an object id before it reaches git. */
function isShaLike(sha: string): boolean {
  return /^[0-9a-fA-F]{4,40}$/.test(sha)
}

export function parseLog(raw: string): GitCommit[] {
  return raw
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, shortSha, authorName, authorEmail, timestamp, parents, refs, subject, body] =
        record.split(FIELD_SEP)
      return {
        sha,
        shortSha,
        authorName,
        authorEmail,
        timestamp: Number(timestamp) || 0,
        parents: parents ? parents.trim().split(' ').filter(Boolean) : [],
        refs: parseRefs(refs ?? ''),
        subject: subject ?? '',
        body: (body ?? '').trim()
      }
    })
    .filter((commit) => commit.sha)
}

/** Turn git's "HEAD -> main, origin/main, tag: v1.0" into typed refs. */
function parseRefs(decoration: string): GitRef[] {
  return decoration
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('tag: ')) return { name: part.slice(5), kind: 'tag' as const }
      // "HEAD -> main" names the branch HEAD is on; the arrow is not part of it.
      if (part.startsWith('HEAD -> ')) return { name: part.slice(8), kind: 'head' as const }
      if (part === 'HEAD') return { name: 'HEAD', kind: 'head' as const }
      return { name: part, kind: part.includes('/') ? ('remote' as const) : ('branch' as const) }
    })
}

const STATUS_LETTERS: Record<string, GitCommitFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'modified'
}

/**
 * Parse `diff-tree --name-status -z`: status and path as separate NUL fields,
 * with renames and copies carrying a source path as a third field.
 */
export function parseNameStatus(raw: string): GitCommitFile[] {
  const fields = raw.split('\0').filter((field) => field.length > 0)
  const files: GitCommitFile[] = []

  for (let i = 0; i < fields.length; ) {
    const code = fields[i][0]
    const status = STATUS_LETTERS[code]
    if (!status) {
      i++
      continue
    }
    const renamed = code === 'R' || code === 'C'
    const origPath = renamed ? fields[i + 1] : undefined
    const path = renamed ? fields[i + 2] : fields[i + 1]
    i += renamed ? 3 : 2
    if (!path) continue
    files.push({ path, origPath, status, insertions: 0, deletions: 0, binary: false })
  }

  return files
}

interface LineCounts {
  insertions: number
  deletions: number
  binary: boolean
}

/**
 * Parse `diff-tree --numstat -z`: "adds\tdeletes\tpath" per entry, except a
 * rename splits the path into two more NUL fields, and a binary file reports
 * "-" instead of counts.
 */
export function parseNumstat(raw: string): Map<string, LineCounts> {
  const fields = raw.split('\0').filter((field) => field.length > 0)
  const counts = new Map<string, LineCounts>()

  for (let i = 0; i < fields.length; ) {
    const parts = fields[i].split('\t')
    if (parts.length < 3) {
      i++
      continue
    }
    const [adds, dels, inlinePath] = parts
    // An empty path means the two following fields hold the rename's source and
    // destination; the destination is the one the file list is keyed by.
    const path = inlinePath === '' ? fields[i + 2] : inlinePath
    i += inlinePath === '' ? 3 : 1
    if (!path) continue

    const binary = adds === '-' || dels === '-'
    counts.set(path, {
      insertions: binary ? 0 : Number(adds) || 0,
      deletions: binary ? 0 : Number(dels) || 0,
      binary
    })
  }

  return counts
}

function mergeCommitFiles(
  files: GitCommitFile[],
  counts: Map<string, LineCounts>
): GitCommitFile[] {
  return files.map((file) => {
    const count = counts.get(file.path)
    return count ? { ...file, ...count } : file
  })
}

/**
 * Parse the NUL-separated `--porcelain=v2 --branch` stream.
 *
 * v2 rather than v1 because v1 offers no way to get the rename source and the
 * path unambiguously in the same record, and `-z` because it is the only mode
 * where git leaves paths verbatim instead of C-quoting the ones with spaces or
 * non-ASCII bytes.
 */
export function parseStatusPorcelainV2(raw: string): GitStatus {
  const records = raw.split('\0').filter((record) => record.length > 0)
  const status: GitStatus = {
    branch: '',
    ahead: 0,
    behind: 0,
    detached: false,
    files: []
  }

  for (let i = 0; i < records.length; i++) {
    const record = records[i]

    if (record.startsWith('# ')) {
      const [key, ...rest] = record.slice(2).split(' ')
      const value = rest.join(' ')
      if (key === 'branch.head') {
        status.detached = value === '(detached)'
        status.branch = status.detached ? '' : value
      } else if (key === 'branch.upstream') {
        status.upstream = value
      } else if (key === 'branch.ab') {
        // "+2 -3": ahead of upstream by 2, behind by 3.
        const [ahead, behind] = value.split(' ')
        status.ahead = Math.abs(Number(ahead)) || 0
        status.behind = Math.abs(Number(behind)) || 0
      }
      continue
    }

    if (record.startsWith('? ')) {
      status.files.push({
        path: record.slice(2),
        index: 'unmodified',
        worktree: 'untracked'
      })
      continue
    }

    // Ignored entries only appear with --ignored, but skipping them keeps the
    // parser honest if a caller ever adds the flag.
    if (record.startsWith('! ')) continue

    const entry = parseTrackedEntry(record)
    if (!entry) continue

    // A rename or copy stores its source as a separate NUL-terminated field
    // right after the record — the one place where a record spans two fields.
    if (record.startsWith('2 ')) {
      entry.origPath = records[i + 1] ?? ''
      i++
    }

    status.files.push(entry)
  }

  return status
}

/** Metadata token counts before the path, per entry type in porcelain v2. */
const TRACKED_ENTRY_FIELDS: Record<string, number> = {
  // <XY> <sub> <mH> <mI> <mW> <hH> <hI>
  '1': 7,
  // ...plus <X><score> for the rename/copy similarity
  '2': 8,
  // <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3>
  u: 9
}

function parseTrackedEntry(record: string): GitFileStatus | null {
  const type = record[0]
  const fieldCount = TRACKED_ENTRY_FIELDS[type]
  if (fieldCount === undefined || record[1] !== ' ') return null

  // Walk past the fixed metadata by hand rather than splitting on spaces: the
  // path is the whole remainder and may itself contain spaces.
  let cursor = 2
  for (let field = 0; field < fieldCount; field++) {
    const next = record.indexOf(' ', cursor)
    if (next === -1) return null
    cursor = next + 1
  }

  const xy = record.slice(2, 4)
  const path = record.slice(cursor)
  if (!path) return null

  return type === 'u'
    ? { path, index: 'unmerged', worktree: 'unmerged' }
    : { path, index: toFileState(xy[0]), worktree: toFileState(xy[1]) }
}

function toFileState(code: string): GitFileState {
  switch (code) {
    case 'M':
      return 'modified'
    // A typechange (file became a symlink, say) is a content change as far as
    // the sidebar and the diff view are concerned.
    case 'T':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'unmerged'
    default:
      return 'unmodified'
  }
}

interface BlobRead {
  data: Buffer | null
  tooLarge: boolean
}

/**
 * Confine a renderer-supplied path to the project and normalise it to the
 * repo-relative, forward-slashed form git expects in a `<rev>:<path>` spec.
 * Returns null for anything that escapes, symlinks included.
 */
function toRepoRelative(folderPath: string, filePath: string): string | null {
  const absolute = isAbsolute(filePath) ? filePath : join(folderPath, filePath)
  if (!isPathInsideRoots(absolute, [folderPath])) return null

  const rel = relative(resolvePath(folderPath), resolvePath(absolute))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/**
 * Read one side of the diff out of the object database.
 *
 * A spec that does not resolve — `HEAD:x` for a newly added file, `:x` for an
 * untracked one — is an empty side rather than an error, which is what makes
 * added and deleted files render correctly.
 */
async function readBlob(cwd: string, spec: string): Promise<BlobRead> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['show', spec],
      { cwd, encoding: 'buffer', maxBuffer: GIT_MAX_DIFF_BYTES },
      (error, stdout) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            resolve({ data: null, tooLarge: true })
            return
          }
          resolve({ data: null, tooLarge: false })
          return
        }
        resolve({ data: stdout, tooLarge: false })
      }
    )
  })
}

async function readWorktreeFile(fullPath: string): Promise<BlobRead> {
  try {
    const info = await stat(fullPath)
    if (info.size > GIT_MAX_DIFF_BYTES) return { data: null, tooLarge: true }
    return { data: await readFile(fullPath), tooLarge: false }
  } catch {
    // Missing on disk means deleted in the working tree — an empty side.
    return { data: null, tooLarge: false }
  }
}

function isBinary(data: Buffer | null): boolean {
  if (!data) return false
  return data.subarray(0, BINARY_SNIFF_BYTES).includes(0)
}
