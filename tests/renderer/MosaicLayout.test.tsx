import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import React from 'react'

// --- Mock window.electronAPI ---

const mockElectronAPI = {
  ptyCreate: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  onPtyData: vi.fn().mockReturnValue(vi.fn())
}

Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true
})

// --- Mock react-mosaic-component ---
// We mock Mosaic, MosaicWindow, and getLeaves to avoid DOM complexity

type MosaicNode<T> =
  | T
  | { type: 'split'; direction: string; children: MosaicNode<T>[]; splitPercentages?: number[] }

function getLeavesImpl<T>(tree: MosaicNode<T> | null): T[] {
  if (tree === null || tree === undefined) return []
  if (typeof tree === 'string' || typeof tree === 'number') return [tree as T]
  if (typeof tree === 'object' && 'type' in (tree as object)) {
    const node = tree as { type: string; children?: MosaicNode<T>[] }
    if (node.type === 'split' && Array.isArray(node.children)) {
      return node.children.flatMap((child) => getLeavesImpl(child))
    }
  }
  return []
}

let mosaicOnChangeCb: ((newTree: MosaicNode<string> | null) => void) | null = null
let mosaicRenderTileCb: ((id: string, path: number[]) => React.ReactElement) | null = null
let mosaicZeroStateView: React.ReactElement | null = null
let mosaicValue: MosaicNode<string> | null = null

vi.mock('react-mosaic-component', () => {
  return {
    Mosaic: vi.fn(
      (props: {
        value: MosaicNode<string> | null
        onChange: (newTree: MosaicNode<string> | null) => void
        renderTile: (id: string, path: number[]) => React.ReactElement
        zeroStateView?: React.ReactElement
      }) => {
        mosaicOnChangeCb = props.onChange
        mosaicRenderTileCb = props.renderTile
        mosaicZeroStateView = props.zeroStateView ?? null
        mosaicValue = props.value

        if (props.value === null) {
          return props.zeroStateView ?? null
        }

        const leaves = getLeavesImpl(props.value)
        return (
          <div data-testid="mosaic-root">
            {leaves.map((id) => (
              <div key={id as string} data-testid={`tile-${id}`}>
                {props.renderTile(id as string, [])}
              </div>
            ))}
          </div>
        )
      }
    ),
    MosaicWindow: vi.fn(
      (props: { children?: React.ReactNode; title?: string; path?: number[] }) => (
        <div data-testid="mosaic-window">{props.children}</div>
      )
    ),
    getLeaves: vi.fn((tree: MosaicNode<string> | null) => getLeavesImpl(tree)),
    MosaicWindowContext: React.createContext({ mosaicWindowActions: {} }),
    MosaicContext: React.createContext({
      mosaicActions: {
        remove: vi.fn(),
        expand: vi.fn(),
        hide: vi.fn(),
        show: vi.fn(),
        replaceWith: vi.fn(),
        updateTree: vi.fn(),
        getRoot: vi.fn()
      }
    })
  }
})

// Mock react-mosaic CSS import
vi.mock('react-mosaic-component/react-mosaic-component.css', () => ({}))

// Mock TerminalPanel to avoid xterm.js in tests
vi.mock('@renderer/components/Terminal', () => ({
  TerminalPanel: vi.fn(({ sessionId }: { sessionId: string }) => (
    <div data-testid={`terminal-${sessionId}`} />
  ))
}))

// Mock xterm CSS
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// --- Import component under test AFTER mocks ---
import { MosaicLayout } from '@renderer/components/MosaicLayout'

// --- Tests ---

describe('MosaicLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockElectronAPI.ptyKill.mockResolvedValue(undefined)
    mockElectronAPI.ptyCreate.mockResolvedValue(undefined)
    mockElectronAPI.onPtyData.mockReturnValue(vi.fn())
    mosaicOnChangeCb = null
    mosaicRenderTileCb = null
    mosaicZeroStateView = null
    mosaicValue = null
  })

  it('renders initial panel — Mosaic component appears with a leaf', () => {
    act(() => {
      render(<MosaicLayout />)
    })
    // mosaic-root is rendered because tree has an initial leaf
    expect(screen.getByTestId('mosaic-root')).toBeTruthy()
    // initial tree should have exactly one leaf
    expect(getLeavesImpl(mosaicValue)).toHaveLength(1)
  })

  it('add panel wraps root in a split with the new panel as second child', () => {
    act(() => {
      render(<MosaicLayout />)
    })

    // Find and click the "+ New terminal" button
    const addButton = screen.getByRole('button', { name: /new terminal/i })
    act(() => {
      addButton.click()
    })

    // The tree should now have 2 leaves (split node with 2 children)
    expect(getLeavesImpl(mosaicValue)).toHaveLength(2)
  })

  it('onChange callback updates tree state', () => {
    act(() => {
      render(<MosaicLayout />)
    })

    const newTree: MosaicNode<string> = {
      type: 'split',
      direction: 'row',
      children: ['leaf-a', 'leaf-b'],
      splitPercentages: [50, 50]
    }

    act(() => {
      mosaicOnChangeCb!(newTree)
    })

    // The mosaic receives the updated value
    expect(mosaicValue).toEqual(newTree)
  })

  it('ptyKill called for removed leaf when onChange fires with fewer leaves', () => {
    act(() => {
      render(<MosaicLayout />)
    })

    // Get the initial single leaf id
    const initialLeaves = getLeavesImpl(mosaicValue)
    expect(initialLeaves).toHaveLength(1)
    const removedId = initialLeaves[0] as string

    // Simulate closing the panel — onChange fires with null tree
    act(() => {
      mosaicOnChangeCb!(null)
    })

    expect(mockElectronAPI.ptyKill).toHaveBeenCalledWith(removedId)
  })
})
