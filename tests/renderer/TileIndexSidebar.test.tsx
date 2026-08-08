import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// jsdom does not implement scrollIntoView; the focused row calls it.
Element.prototype.scrollIntoView = vi.fn()

import { TileIndexSidebar } from '@renderer/components/TileIndexSidebar'
import { usePanelStore } from '@renderer/store/panelStore'
import { useCanvasStore } from '@renderer/store/canvasStore'

function addTerminal(id: string, title: string, extra: Record<string, unknown> = {}): void {
  usePanelStore.getState().addPanel(id, title, undefined, 'terminal', undefined, undefined, '/proj')
  usePanelStore.setState((s) => ({
    panels: { ...s.panels, [id]: { ...s.panels[id], ...extra } }
  }))
}

function order(...ids: string[]): void {
  useCanvasStore.setState({ tileOrder: ids })
}

describe('TileIndexSidebar', () => {
  beforeEach(() => {
    usePanelStore.setState({ panels: {}, pendingReveal: null })
    useCanvasStore.setState({
      tileOrder: [],
      focusedId: null,
      maximizedId: null,
      offscreenIds: new Set()
    })
  })

  it('says when there is nothing open', () => {
    render(<TileIndexSidebar />)

    expect(screen.getByText('No tiles open')).toBeTruthy()
  })

  it('lists tiles in canvas order under their type', () => {
    addTerminal('t1', 'Shell')
    usePanelStore.getState().addPanel('e1', 'a.ts', undefined, 'editor', '/proj/a.ts')
    order('t1', 'e1')

    render(<TileIndexSidebar />)

    expect(screen.getByText('Terminals')).toBeTruthy()
    expect(screen.getByText('Editors')).toBeTruthy()
    expect(screen.getByText('Shell')).toBeTruthy()
    expect(screen.getByText('a.ts')).toBeTruthy()
  })

  it('leaves out a group with no tiles', () => {
    addTerminal('t1', 'Shell')
    order('t1')

    render(<TileIndexSidebar />)

    expect(screen.queryByText('Notes')).toBeNull()
  })

  it('ignores an id with no panel behind it', () => {
    // The canvas order and the panel record are updated by separate effects, so
    // a render can land in between.
    order('t1', 'ghost')
    addTerminal('t1', 'Shell')

    render(<TileIndexSidebar />)

    expect(screen.getByText('Shell')).toBeTruthy()
  })

  it('names what a terminal is running, and idle when it is not', () => {
    addTerminal('t1', 'Shell', { hasProcess: true, processName: 'vitest' })
    addTerminal('t2', 'Other')
    order('t1', 't2')

    render(<TileIndexSidebar />)

    expect(screen.getByText('vitest')).toBeTruthy()
    expect(screen.getByText('idle')).toBeTruthy()
  })

  it('ranks attention above a running process on the status dot', () => {
    addTerminal('t1', 'Shell', { hasProcess: true, processName: 'npm', attention: true })
    order('t1')

    render(<TileIndexSidebar />)

    expect(screen.getByLabelText('Waiting for you')).toBeTruthy()
    expect(screen.queryByLabelText('Process running')).toBeNull()
  })

  it('marks an active agent', () => {
    addTerminal('t1', 'Claude Code', { agentActive: true })
    order('t1')

    render(<TileIndexSidebar />)

    expect(screen.getByLabelText('Claude agent active')).toBeTruthy()
  })

  it('shortens the home directory in the path line', () => {
    usePanelStore
      .getState()
      .addPanel('t1', 'Shell', undefined, 'terminal', undefined, undefined, '/Users/someone/proj')
    order('t1')

    render(<TileIndexSidebar />)

    expect(screen.getByText('~/proj')).toBeTruthy()
  })

  it('flags a tile that is off screen', () => {
    addTerminal('t1', 'Shell')
    order('t1')
    useCanvasStore.setState({ offscreenIds: new Set(['t1']) })

    render(<TileIndexSidebar />)

    expect(screen.getByTitle(/off screen/)).toBeTruthy()
  })

  it('asks the canvas to pan to a clicked tile', () => {
    addTerminal('t1', 'Shell')
    order('t1')

    render(<TileIndexSidebar />)
    fireEvent.click(screen.getByText('Shell'))

    expect(usePanelStore.getState().pendingReveal).toEqual({ id: 't1', maximize: false })
  })

  it('maximizes on a double click', () => {
    addTerminal('t1', 'Shell')
    order('t1')

    render(<TileIndexSidebar />)
    fireEvent.doubleClick(screen.getByText('Shell'))

    expect(usePanelStore.getState().pendingReveal).toEqual({ id: 't1', maximize: true })
  })

  it('marks the focused tile', () => {
    addTerminal('t1', 'Shell')
    addTerminal('t2', 'Other')
    order('t1', 't2')
    useCanvasStore.setState({ focusedId: 't2' })

    const { container } = render(<TileIndexSidebar />)
    const focused = container.querySelectorAll('.tile-index-row--focused')

    expect(focused).toHaveLength(1)
    expect(focused[0].textContent).toContain('Other')
  })

  it('collapses through the header button', () => {
    const onToggle = vi.fn()

    render(<TileIndexSidebar onToggle={onToggle} />)
    fireEvent.click(screen.getByLabelText('Hide tile index'))

    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('leaves out the collapse button when there is nothing to collapse into', () => {
    render(<TileIndexSidebar />)

    expect(screen.queryByLabelText('Hide tile index')).toBeNull()
  })
})
