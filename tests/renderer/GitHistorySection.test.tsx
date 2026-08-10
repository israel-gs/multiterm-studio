import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { GitCommit, GitCommitDetail } from '../../src/shared/git'

const gitCommitDetail = vi.fn()
const clipboardWriteText = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { gitCommitDetail, clipboardWriteText },
  writable: true
})

import { GitHistorySection } from '@renderer/components/GitHistorySection'
import { useGitStore } from '@renderer/store/gitStore'
import { useProjectStore } from '@renderer/store/projectStore'

function commit(overrides: Partial<GitCommit> & { sha: string }): GitCommit {
  return {
    shortSha: overrides.sha.slice(0, 7),
    authorName: 'Israel',
    authorEmail: 'i@example.com',
    timestamp: Math.floor(Date.now() / 1000) - 3600,
    parents: [],
    refs: [],
    subject: 'a commit',
    body: '',
    ...overrides
  }
}

/** The card waits out a hover delay, which has to elapse inside act(). */
async function hover(element: Element): Promise<void> {
  await act(async () => {
    fireEvent.mouseEnter(element)
    await new Promise((resolve) => setTimeout(resolve, 300))
  })
}

function detail(sha: string): GitCommitDetail {
  return {
    sha,
    files: [
      { path: 'src/a.ts', status: 'modified', insertions: 3, deletions: 1, binary: false },
      { path: 'b.md', status: 'added', insertions: 5, deletions: 0, binary: false }
    ],
    insertions: 8,
    deletions: 1
  }
}

describe('GitHistorySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGitStore.getState().reset()
    useProjectStore.setState({ pendingDiffOpen: null })
    gitCommitDetail.mockResolvedValue({ ok: true, detail: detail('aaaa111') })
  })

  it('says when there is no history yet', () => {
    render(<GitHistorySection folderPath="/proj" />)

    expect(screen.getByText('No commits yet')).toBeTruthy()
  })

  it('lists commits with author and age', () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111', subject: 'first thing' })] })

    render(<GitHistorySection folderPath="/proj" />)

    expect(screen.getByText('first thing')).toBeTruthy()
    expect(screen.getByText(/Israel/)).toBeTruthy()
    expect(screen.getByText(/1 hour ago/)).toBeTruthy()
  })

  it('shows the refs pointing at a commit', () => {
    useGitStore.setState({
      commits: [
        commit({
          sha: 'aaaa111',
          refs: [
            { name: 'main', kind: 'head' },
            { name: 'v1', kind: 'tag' }
          ]
        })
      ]
    })

    render(<GitHistorySection folderPath="/proj" />)

    expect(screen.getByText('main')).toBeTruthy()
    expect(screen.getByText('v1')).toBeTruthy()
  })

  it('draws one graph dot per commit', () => {
    useGitStore.setState({
      commits: [commit({ sha: 'bbbb222', parents: ['aaaa111'] }), commit({ sha: 'aaaa111' })]
    })

    const { container } = render(<GitHistorySection folderPath="/proj" />)

    expect(container.querySelectorAll('.git-history-gutter circle')).toHaveLength(2)
  })

  it('bends a branch that ends into the commit rather than leaving it hanging', () => {
    // Two tips over one parent: the second lane must be drawn as a curve into
    // the dot, which is a path, not a straight pass-through line.
    useGitStore.setState({
      commits: [
        commit({ sha: 'tipA', subject: 'tip a', parents: ['base'] }),
        commit({ sha: 'tipB', subject: 'tip b', parents: ['base'] }),
        commit({ sha: 'base', subject: 'base' })
      ]
    })

    const { container } = render(<GitHistorySection folderPath="/proj" />)
    const rows = container.querySelectorAll('.git-history-gutter')
    const baseRow = rows[2]

    expect(baseRow.querySelectorAll('path').length).toBeGreaterThan(0)
    // Nothing may stop halfway down with no dot to meet: the only straight
    // lines left are full-height pass-throughs.
    for (const line of baseRow.querySelectorAll('line')) {
      const y2 = Number(line.getAttribute('y2'))
      expect(y2 === 34 || Number(line.getAttribute('x1')) === 6).toBe(true)
    }
  })

  it('reads the detail on hover and reports the totals', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    await hover(screen.getByText('a commit').closest('li')!)

    await waitFor(() => expect(gitCommitDetail).toHaveBeenCalledWith('/proj', 'aaaa111'))
    expect(screen.getByText('2 files')).toBeTruthy()
    expect(screen.getByText('+8')).toBeTruthy()
  })

  it('renders the hover card outside the sidebar, which clips its own overflow', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    const { container } = render(<GitHistorySection folderPath="/proj" />)
    await hover(screen.getByText('a commit').closest('li')!)

    expect(document.querySelector('.git-history-card')).toBeTruthy()
    // Portalled to the body, so it is not inside the rendered subtree.
    expect(container.querySelector('.git-history-card')).toBeNull()
  })

  it('drops the card once the pointer has been away long enough', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    const row = screen.getByText('a commit').closest('li')!
    await hover(row)
    expect(document.querySelector('.git-history-card')).toBeTruthy()

    await act(async () => {
      fireEvent.mouseLeave(row)
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(document.querySelector('.git-history-card')).toBeNull()
  })

  it('keeps the card open while the pointer is on it, so it can be scrolled', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111', body: 'a very long body' })] })

    render(<GitHistorySection folderPath="/proj" />)
    const row = screen.getByText('a commit').closest('li')!
    await hover(row)
    const card = document.querySelector('.git-history-card')!

    // Crossing the gap fires mouseleave on the row before mouseenter on the
    // card; without the grace period the card would be gone by then.
    await act(async () => {
      fireEvent.mouseLeave(row)
      fireEvent.mouseEnter(card)
      await new Promise((resolve) => setTimeout(resolve, 400))
    })

    expect(document.querySelector('.git-history-card')).toBeTruthy()
    expect(screen.getByText('a very long body')).toBeTruthy()
  })

  it('closes after the pointer leaves the card itself', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    const row = screen.getByText('a commit').closest('li')!
    await hover(row)
    const card = document.querySelector('.git-history-card')!

    await act(async () => {
      fireEvent.mouseEnter(card)
      fireEvent.mouseLeave(card)
      await new Promise((resolve) => setTimeout(resolve, 300))
    })

    expect(document.querySelector('.git-history-card')).toBeNull()
  })

  it('does not show a card for a commit whose files are already open', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    fireEvent.click(screen.getByText('a commit'))
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    await hover(screen.getByText('a commit').closest('li')!)

    expect(document.querySelector('.git-history-card')).toBeNull()
  })

  it('lists the files of an opened commit', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    fireEvent.click(screen.getByText('a commit'))

    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    expect(screen.getByText('b.md')).toBeTruthy()
  })

  it('opens a file of that commit as a diff against its parent', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    fireEvent.click(screen.getByText('a commit'))
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('a.ts'))

    expect(useProjectStore.getState().pendingDiffOpen).toEqual({
      filePath: '/proj/src/a.ts',
      staged: false,
      sha: 'aaaa111'
    })
  })

  it('reads a commit only once however often it is opened', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    fireEvent.click(screen.getByText('a commit'))
    await waitFor(() => expect(gitCommitDetail).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('a commit'))
    fireEvent.click(screen.getByText('a commit'))
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    expect(gitCommitDetail).toHaveBeenCalledTimes(1)
  })

  it('copies the full sha, not the abbreviation', async () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })] })

    render(<GitHistorySection folderPath="/proj" />)
    fireEvent.click(screen.getByText('a commit'))
    await waitFor(() => expect(screen.getByLabelText('Copy commit id')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Copy commit id'))

    expect(clipboardWriteText).toHaveBeenCalledWith('aaaa111')
  })

  it('surfaces a history failure', () => {
    useGitStore.setState({ commitsError: 'not a repository' })

    render(<GitHistorySection folderPath="/proj" />)

    expect(screen.getByText('not a repository')).toBeTruthy()
  })

  it('offers more only while there is more', () => {
    useGitStore.setState({ commits: [commit({ sha: 'aaaa111' })], hasMoreCommits: true })

    render(<GitHistorySection folderPath="/proj" />)

    expect(screen.getByText('Load more commits')).toBeTruthy()
  })
})
