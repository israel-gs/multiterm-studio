import { describe, it, expect, beforeEach } from 'vitest'
import { usePanelStore } from '@renderer/store/panelStore'

describe('panelStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    usePanelStore.setState({ panels: {} })
  })

  it('panels record is empty on initial store creation', () => {
    const panels = usePanelStore.getState().panels
    expect(panels).toEqual({})
  })

  it('addPanel adds entry with default title "Terminal" and default color "#569cd6"', () => {
    usePanelStore.getState().addPanel('panel-1')
    const panels = usePanelStore.getState().panels
    expect(panels['panel-1']).toEqual({ title: 'Terminal', color: '#569cd6' })
  })

  it('removePanel removes entry for existing id', () => {
    usePanelStore.getState().addPanel('panel-1')
    usePanelStore.getState().removePanel('panel-1')
    const panels = usePanelStore.getState().panels
    expect(panels['panel-1']).toBeUndefined()
  })

  it('removePanel for non-existent id is a no-op (does not crash)', () => {
    expect(() => {
      usePanelStore.getState().removePanel('non-existent-id')
    }).not.toThrow()
    // other panels should remain unaffected
    usePanelStore.getState().addPanel('panel-2')
    usePanelStore.getState().removePanel('non-existent-id')
    expect(usePanelStore.getState().panels['panel-2']).toBeDefined()
  })

  it('setTitle updates title for given id', () => {
    usePanelStore.getState().addPanel('panel-1')
    usePanelStore.getState().setTitle('panel-1', 'My Terminal')
    expect(usePanelStore.getState().panels['panel-1'].title).toBe('My Terminal')
  })

  it('setColor updates color for given id', () => {
    usePanelStore.getState().addPanel('panel-1')
    usePanelStore.getState().setColor('panel-1', '#f44747')
    expect(usePanelStore.getState().panels['panel-1'].color).toBe('#f44747')
  })
})
