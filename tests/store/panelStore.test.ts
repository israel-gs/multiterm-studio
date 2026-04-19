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

  it('addPanel adds entry with default title "Terminal" and default color "#1c1c1c"', () => {
    usePanelStore.getState().addPanel('panel-1')
    const panels = usePanelStore.getState().panels
    // UPDATED: store now includes agentActive, hasProcess, cwd, initialCommand fields
    expect(panels['panel-1']).toEqual({
      title: 'Terminal',
      color: '#1c1c1c',
      attention: false,
      type: 'terminal',
      filePath: undefined,
      dirty: false,
      previewMode: false,
      agentActive: false,
      hasProcess: false,
      initialCommand: undefined,
      cwd: undefined
    })
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

  // --- Attention badge (ATTN-01, ATTN-02) ---

  it('addPanel creates entry with attention: false', () => {
    usePanelStore.getState().addPanel('panel-1')
    expect(usePanelStore.getState().panels['panel-1'].attention).toBe(false)
  })

  it('setAttention(id) sets attention to true', () => {
    usePanelStore.getState().addPanel('panel-1')
    usePanelStore.getState().setAttention('panel-1')
    expect(usePanelStore.getState().panels['panel-1'].attention).toBe(true)
  })

  it('clearAttention(id) sets attention to false', () => {
    usePanelStore.getState().addPanel('panel-1')
    usePanelStore.getState().setAttention('panel-1')
    usePanelStore.getState().clearAttention('panel-1')
    expect(usePanelStore.getState().panels['panel-1'].attention).toBe(false)
  })

  it('clearAttention on non-existent panel does not throw', () => {
    expect(() => {
      usePanelStore.getState().clearAttention('non-existent-id')
    }).not.toThrow()
  })

  // --- addPanel optional title/color for restore (PERS-01) ---

  it('addPanel with optional title and color uses provided values instead of defaults', () => {
    usePanelStore.getState().addPanel('panel-restore', 'My Build', '#f44747')
    const panel = usePanelStore.getState().panels['panel-restore']
    // UPDATED: store now includes agentActive, hasProcess, cwd, initialCommand fields
    expect(panel).toEqual({
      title: 'My Build',
      color: '#f44747',
      attention: false,
      type: 'terminal',
      filePath: undefined,
      dirty: false,
      previewMode: false,
      agentActive: false,
      hasProcess: false,
      initialCommand: undefined,
      cwd: undefined
    })
  })

  it('addPanel without optional parameters still uses "Terminal" and "#1c1c1c" defaults', () => {
    usePanelStore.getState().addPanel('panel-default')
    const panel = usePanelStore.getState().panels['panel-default']
    // UPDATED: store now includes agentActive, hasProcess, cwd, initialCommand fields
    expect(panel).toEqual({
      title: 'Terminal',
      color: '#1c1c1c',
      attention: false,
      type: 'terminal',
      filePath: undefined,
      dirty: false,
      previewMode: false,
      agentActive: false,
      hasProcess: false,
      initialCommand: undefined,
      cwd: undefined
    })
  })
})
