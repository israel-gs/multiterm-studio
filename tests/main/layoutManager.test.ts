import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted() required so mock refs are initialized before vi.mock() factory executes
// (vi.mock() is hoisted to top of file by Vitest; standard declarations are undefined there)
const {
  mockMkdir,
  mockWriteFile,
  mockReadFile,
  mockAppendFile,
  mockExistsSync,
  mockWriteFileSync,
  mockMkdirSync
} = vi.hoisted(() => ({
  mockMkdir: vi.fn(),
  mockWriteFile: vi.fn(),
  mockReadFile: vi.fn(),
  mockAppendFile: vi.fn(),
  mockExistsSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn()
}))

// Mock fs/promises using the project's established dual-export pattern
vi.mock('fs/promises', () => ({
  default: {
    mkdir: mockMkdir,
    writeFile: mockWriteFile,
    readFile: mockReadFile,
    appendFile: mockAppendFile
  },
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  appendFile: mockAppendFile
}))

// Mock fs for synchronous operations
vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    writeFileSync: mockWriteFileSync,
    mkdirSync: mockMkdirSync
  },
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync
}))

import { saveLayout, saveLayoutSync, loadLayout, ensureGitignore } from '../../src/main/layoutManager'
import type { LayoutSnapshot } from '../../src/main/layoutManager'

const sampleSnapshot: LayoutSnapshot = {
  version: 1,
  tree: 'panel-abc',
  panels: [{ id: 'panel-abc', title: 'My Terminal', color: '#569cd6' }]
}

const folderPath = '/some/project'
const layoutPath = `${folderPath}/.multiterm/layout.json`
const multitermDir = `${folderPath}/.multiterm`

describe('layoutManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockReadFile.mockResolvedValue(JSON.stringify(sampleSnapshot))
    mockAppendFile.mockResolvedValue(undefined)
    mockExistsSync.mockReturnValue(true)
    mockWriteFileSync.mockReturnValue(undefined)
    mockMkdirSync.mockReturnValue(undefined)
  })

  // --- saveLayout ---

  it('saveLayout creates .multiterm dir with recursive:true', async () => {
    await saveLayout(folderPath, sampleSnapshot)
    expect(mockMkdir).toHaveBeenCalledWith(multitermDir, { recursive: true })
  })

  it('saveLayout writes JSON to layout.json', async () => {
    await saveLayout(folderPath, sampleSnapshot)
    expect(mockWriteFile).toHaveBeenCalledWith(layoutPath, JSON.stringify(sampleSnapshot, null, 2))
  })

  it('saveLayout does not throw when writeFile rejects', async () => {
    mockWriteFile.mockRejectedValue(new Error('disk full'))
    await expect(saveLayout(folderPath, sampleSnapshot)).resolves.not.toThrow()
  })

  // --- saveLayoutSync ---

  it('saveLayoutSync calls mkdirSync with recursive:true and writeFileSync with correct path', () => {
    saveLayoutSync(folderPath, sampleSnapshot)
    expect(mockMkdirSync).toHaveBeenCalledWith(multitermDir, { recursive: true })
    expect(mockWriteFileSync).toHaveBeenCalledWith(layoutPath, JSON.stringify(sampleSnapshot, null, 2))
  })

  it('saveLayoutSync does not propagate writeFileSync errors', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('write error')
    })
    expect(() => saveLayoutSync(folderPath, sampleSnapshot)).not.toThrow()
  })

  // --- loadLayout ---

  it('loadLayout returns parsed LayoutSnapshot when file is valid JSON', async () => {
    const result = await loadLayout(folderPath)
    expect(result).toEqual(sampleSnapshot)
  })

  it('loadLayout returns null when file does not exist (ENOENT)', async () => {
    const enoentError = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(enoentError)
    const result = await loadLayout(folderPath)
    expect(result).toBeNull()
  })

  it('loadLayout returns null when file contains invalid JSON', async () => {
    mockReadFile.mockResolvedValue('{invalid json')
    const result = await loadLayout(folderPath)
    expect(result).toBeNull()
  })

  // --- ensureGitignore ---

  it('ensureGitignore appends .multiterm/ when .gitignore exists and does not contain .multiterm', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValue('node_modules/\ndist/\n')
    await ensureGitignore(folderPath)
    expect(mockAppendFile).toHaveBeenCalledWith(
      `${folderPath}/.gitignore`,
      '\n# Multiterm Studio local config\n.multiterm/\n'
    )
  })

  it('ensureGitignore is a no-op when .gitignore already contains .multiterm', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFile.mockResolvedValue('node_modules/\n.multiterm/\n')
    await ensureGitignore(folderPath)
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it('ensureGitignore is a no-op when .gitignore does not exist', async () => {
    mockExistsSync.mockReturnValue(false)
    await ensureGitignore(folderPath)
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockAppendFile).not.toHaveBeenCalled()
  })
})
