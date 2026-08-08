import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { FileSearchResult } from '../../src/shared/search'

const fileSearch = vi.fn<(rootPath: string, query: string) => Promise<FileSearchResult>>()

Object.defineProperty(window, 'electronAPI', {
  value: { fileSearch },
  writable: true
})

import { SearchView } from '@renderer/components/SearchView'
import { useProjectStore } from '@renderer/store/projectStore'

function result(paths: string[], truncated = false): FileSearchResult {
  return {
    matches: paths.map((relativePath) => ({ path: `/proj/${relativePath}`, relativePath })),
    truncated
  }
}

async function type(value: string): Promise<void> {
  fireEvent.change(screen.getByLabelText('Search files by name'), { target: { value } })
}

describe('SearchView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({ pendingFileOpen: null })
    fileSearch.mockResolvedValue(result([]))
  })

  it('does not search until something is typed', () => {
    render(<SearchView rootPaths={['/proj']} />)

    expect(fileSearch).not.toHaveBeenCalled()
    expect(screen.getByText(/Type to search/)).toBeTruthy()
  })

  it('searches the root and lists the matches', async () => {
    fileSearch.mockResolvedValue(result(['src/main/gitManager.ts', 'README.md']))

    render(<SearchView rootPaths={['/proj']} />)
    await type('git')

    await waitFor(() => expect(screen.getByText('gitManager.ts')).toBeTruthy())
    expect(fileSearch).toHaveBeenCalledWith('/proj', 'git')
    expect(screen.getByText('src/main')).toBeTruthy()
    expect(screen.getByText('2 results')).toBeTruthy()
  })

  it('searches every root of a multi-root workspace', async () => {
    render(<SearchView rootPaths={['/a', '/b']} />)
    await type('index')

    await waitFor(() => {
      expect(fileSearch).toHaveBeenCalledWith('/a', 'index')
      expect(fileSearch).toHaveBeenCalledWith('/b', 'index')
    })
  })

  it('reports a bridge that throws instead of searching forever', async () => {
    // A missing bridge method throws synchronously, before any promise exists.
    fileSearch.mockImplementation(() => {
      throw new TypeError('fileSearch is not a function')
    })

    render(<SearchView rootPaths={['/proj']} />)
    await type('git')

    await waitFor(() => expect(screen.getByText('fileSearch is not a function')).toBeTruthy())
    expect(screen.queryByText('Searching...')).toBeNull()
  })

  it('reports a rejected search instead of searching forever', async () => {
    fileSearch.mockRejectedValue(new Error('No handler registered for file:search'))

    render(<SearchView rootPaths={['/proj']} />)
    await type('git')

    await waitFor(() =>
      expect(screen.getByText('No handler registered for file:search')).toBeTruthy()
    )
  })

  it('reports an empty search rather than looking stuck', async () => {
    render(<SearchView rootPaths={['/proj']} />)
    await type('nothing')

    await waitFor(() => expect(screen.getByText(/No files match/)).toBeTruthy())
  })

  it('says when the walk was cut short', async () => {
    fileSearch.mockResolvedValue(result(['a.ts'], true))

    render(<SearchView rootPaths={['/proj']} />)
    await type('a')

    await waitFor(() => expect(screen.getByText(/partial/)).toBeTruthy())
  })

  it('opens the clicked result in the editor', async () => {
    fileSearch.mockResolvedValue(result(['src/main/gitManager.ts']))

    render(<SearchView rootPaths={['/proj']} />)
    await type('git')
    await waitFor(() => expect(screen.getByText('gitManager.ts')).toBeTruthy())
    fireEvent.click(screen.getByText('gitManager.ts'))

    expect(useProjectStore.getState().pendingFileOpen).toBe('/proj/src/main/gitManager.ts')
  })

  it('collapses keystrokes into a single search', async () => {
    vi.useFakeTimers()
    render(<SearchView rootPaths={['/proj']} />)

    await act(async () => {
      await type('g')
      await type('gi')
      await type('git')
      await vi.advanceTimersByTimeAsync(400)
    })

    expect(fileSearch).toHaveBeenCalledTimes(1)
    expect(fileSearch).toHaveBeenCalledWith('/proj', 'git')
    vi.useRealTimers()
  })

  it('clears the query and the results', async () => {
    fileSearch.mockResolvedValue(result(['a.ts']))

    render(<SearchView rootPaths={['/proj']} />)
    await type('a')
    await waitFor(() => expect(screen.getByText('a.ts')).toBeTruthy())

    fireEvent.click(screen.getByLabelText('Clear search'))

    expect(screen.getByText(/Type to search/)).toBeTruthy()
  })
})
