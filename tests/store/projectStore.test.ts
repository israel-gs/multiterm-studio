import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectStore } from '@renderer/store/projectStore'

describe('projectStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useProjectStore.setState({ folderPath: null })
  })

  it('folderPath is null on initial store creation', () => {
    const folderPath = useProjectStore.getState().folderPath
    expect(folderPath).toBeNull()
  })

  it('setFolderPath updates folderPath to the given string', () => {
    useProjectStore.getState().setFolderPath('/home/user/my-project')
    const folderPath = useProjectStore.getState().folderPath
    expect(folderPath).toBe('/home/user/my-project')
  })

  it('setFolderPath overwrites a previously set path', () => {
    useProjectStore.getState().setFolderPath('/first/path')
    useProjectStore.getState().setFolderPath('/second/path')
    const folderPath = useProjectStore.getState().folderPath
    expect(folderPath).toBe('/second/path')
  })
})
