import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import React from 'react'
import { usePanelStore } from '@renderer/store/panelStore'

// --- Hoist mocks so they are available inside vi.mock() factory ---
const { mockSplit, mockRemove } = vi.hoisted(() => ({
  mockSplit: vi.fn().mockResolvedValue(undefined),
  mockRemove: vi.fn()
}))

// --- Mock react-mosaic-component ---
// MosaicWindowContext provides mosaicWindowActions (split, etc.)
// MosaicContext provides mosaicActions (remove, etc.)

vi.mock('react-mosaic-component', () => {
  const MosaicWindowContext = React.createContext({
    blueprintNamespace: 'bp5',
    mosaicWindowActions: {
      split: mockSplit,
      addTab: vi.fn(),
      getRoot: vi.fn(),
      replaceWithNew: vi.fn(),
      setAdditionalControlsOpen: vi.fn(),
      getPath: vi.fn(() => [] as number[]),
      connectDragSource: vi.fn()
    }
  })

  const MosaicContext = React.createContext({
    mosaicActions: {
      remove: mockRemove,
      expand: vi.fn(),
      hide: vi.fn(),
      show: vi.fn(),
      replaceWith: vi.fn(),
      updateTree: vi.fn(),
      getRoot: vi.fn()
    },
    mosaicId: 'test-mosaic',
    blueprintNamespace: 'bp5'
  })

  return {
    MosaicWindowContext,
    MosaicContext,
    MosaicWindow: vi.fn(({ children }: { children?: React.ReactNode }) => (
      <div>{children}</div>
    )),
    Mosaic: vi.fn(() => null),
    getLeaves: vi.fn(() => [])
  }
})

// Mock xterm CSS
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('react-mosaic-component/react-mosaic-component.css', () => ({}))

// --- Import after mocks ---
import { PanelHeader } from '@renderer/components/PanelHeader'

// Helper to render PanelHeader wrapped in both contexts
function renderWithContexts(
  ui: React.ReactElement,
  opts?: { path?: number[] }
): ReturnType<typeof render> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MosaicWindowContext, MosaicContext } = require('react-mosaic-component')
  const path = opts?.path ?? []

  return render(
    <MosaicContext.Provider
      value={{
        mosaicActions: {
          remove: mockRemove,
          expand: vi.fn(),
          hide: vi.fn(),
          show: vi.fn(),
          replaceWith: vi.fn(),
          updateTree: vi.fn(),
          getRoot: vi.fn()
        },
        mosaicId: 'test-mosaic',
        blueprintNamespace: 'bp5'
      }}
    >
      <MosaicWindowContext.Provider
        value={{
          blueprintNamespace: 'bp5',
          mosaicWindowActions: {
            split: mockSplit,
            addTab: vi.fn(),
            getRoot: vi.fn(),
            replaceWithNew: vi.fn(),
            setAdditionalControlsOpen: vi.fn(),
            getPath: vi.fn(() => path),
            connectDragSource: vi.fn()
          }
        }}
      >
        {ui}
      </MosaicWindowContext.Provider>
    </MosaicContext.Provider>
  )
}

// --- Tests ---

describe('PanelHeader', () => {
  const TEST_SESSION_ID = 'test-session-123'

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset zustand store between tests
    usePanelStore.setState({ panels: {} })
    // Add a test panel with defaults (title='Terminal', color='#569cd6')
    usePanelStore.getState().addPanel(TEST_SESSION_ID)
  })

  it('split button calls mosaicWindowActions.split', () => {
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    const splitBtn = screen.getByTitle(/split/i)
    act(() => {
      fireEvent.click(splitBtn)
    })

    expect(mockSplit).toHaveBeenCalled()
  })

  it('close button calls mosaicActions.remove', () => {
    const path = [0, 1]
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={path} />, { path })

    const closeBtn = screen.getByTitle(/close/i)
    act(() => {
      fireEvent.click(closeBtn)
    })

    expect(mockRemove).toHaveBeenCalledWith(path)
  })

  it('displays panel title from store', () => {
    usePanelStore.getState().setTitle(TEST_SESSION_ID, 'My Shell')
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    expect(screen.getByText('My Shell')).toBeTruthy()
  })

  it('double-click title enters edit mode', () => {
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    const titleSpan = screen.getByText('Terminal')
    act(() => {
      fireEvent.dblClick(titleSpan)
    })

    const input = screen.queryByRole('textbox')
    expect(input).toBeTruthy()
    expect((input as HTMLInputElement).value).toBe('Terminal')
  })

  it('blur saves title to store', () => {
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    // Enter edit mode
    const titleSpan = screen.getByText('Terminal')
    act(() => {
      fireEvent.dblClick(titleSpan)
    })

    const input = screen.getByRole('textbox') as HTMLInputElement
    act(() => {
      fireEvent.change(input, { target: { value: 'New Title' } })
      fireEvent.blur(input)
    })

    // Input should be gone
    expect(screen.queryByRole('textbox')).toBeNull()
    // Store should have updated title
    const stored = usePanelStore.getState().panels[TEST_SESSION_ID]
    expect(stored.title).toBe('New Title')
  })

  it('Enter key triggers blur/save', () => {
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    // Enter edit mode
    const titleSpan = screen.getByText('Terminal')
    act(() => {
      fireEvent.dblClick(titleSpan)
    })

    const input = screen.getByRole('textbox')
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    // Edit mode should exit (input gone)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('color dot shows current color', () => {
    usePanelStore.getState().setColor(TEST_SESSION_ID, '#f44747')
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    const colorDot = screen.getByTestId('color-dot')
    expect(colorDot.style.background).toBe('rgb(244, 71, 71)')
  })

  it('clicking color option calls setColor', () => {
    renderWithContexts(<PanelHeader sessionId={TEST_SESSION_ID} path={[]} />)

    // Click the green color option
    const greenOption = screen.getByTestId('color-option-#6a9955')
    act(() => {
      fireEvent.click(greenOption)
    })

    const stored = usePanelStore.getState().panels[TEST_SESSION_ID]
    expect(stored.color).toBe('#6a9955')
  })
})
