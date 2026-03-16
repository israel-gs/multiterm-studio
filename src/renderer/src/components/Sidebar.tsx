import React from 'react'
import { FileTree } from './FileTree'

interface SidebarProps {
  folderPath: string
}

export function Sidebar({ folderPath }: SidebarProps): React.JSX.Element {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--bg-panel)',
        borderRight: '1px solid #3e3e3e',
        overflowY: 'auto',
        height: '100%'
      }}
    >
      <FileTree rootPath={folderPath} />
    </aside>
  )
}
