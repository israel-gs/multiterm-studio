import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

// --- Mock window.electronAPI ---

const mockFolderReaddir = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: {
    ptyCreate: vi.fn(),
    ptyWrite: vi.fn(),
    ptyResize: vi.fn(),
    ptyKill: vi.fn(),
    onPtyData: vi.fn().mockReturnValue(vi.fn()),
    folderOpen: vi.fn(),
    folderReaddir: mockFolderReaddir
  },
  writable: true
})

// --- Import component under test ---
import { FileTree } from '@renderer/components/FileTree'

// --- Tests ---

describe('FileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFolderReaddir.mockResolvedValue([])
  })

  it('renders root entries from folderReaddir', async () => {
    mockFolderReaddir.mockResolvedValue([
      { name: 'src', isDir: true },
      { name: 'README.md', isDir: false }
    ])

    render(<FileTree rootPath="/test" />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    expect(mockFolderReaddir).toHaveBeenCalledWith('/test')
  })

  it('expand directory fetches children lazily', async () => {
    mockFolderReaddir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])

    render(<FileTree rootPath="/test" />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    // Click src to expand
    fireEvent.click(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    expect(mockFolderReaddir).toHaveBeenCalledWith('/test/src')
  })

  it('collapse and re-expand does not re-fetch (children cached)', async () => {
    mockFolderReaddir
      .mockResolvedValueOnce([{ name: 'src', isDir: true }])
      .mockResolvedValueOnce([{ name: 'index.ts', isDir: false }])

    render(<FileTree rootPath="/test" />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    // Expand
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    // Collapse
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => {
      expect(screen.queryByText('index.ts')).not.toBeInTheDocument()
    })

    // Re-expand
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })

    // folderReaddir for /test/src should only be called once (cache hit on re-expand)
    const subdirCalls = mockFolderReaddir.mock.calls.filter(
      (call) => call[0] === '/test/src'
    )
    expect(subdirCalls).toHaveLength(1)
  })

  it('file entries do not expand on click', async () => {
    mockFolderReaddir.mockResolvedValue([{ name: 'README.md', isDir: false }])

    render(<FileTree rootPath="/test" />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    // Click the file entry
    fireEvent.click(screen.getByText('README.md'))

    // folderReaddir should NOT be called for the file's path
    const fileCalls = mockFolderReaddir.mock.calls.filter(
      (call) => call[0] === '/test/README.md'
    )
    expect(fileCalls).toHaveLength(0)
  })
})
