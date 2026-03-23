import { ipcMain } from 'electron'
import { updateManager } from './update-manager'

export { updateManager } from './update-manager'
export type { UpdateState, UpdateStatus } from './update-manager'

let updateIPCRegistered = false

export function setupUpdateIPC(): void {
  if (updateIPCRegistered) return
  updateIPCRegistered = true
  ipcMain.handle('update:getStatus', () => updateManager.getState())

  ipcMain.handle('update:check', async () => {
    await updateManager.checkForUpdates()
    return updateManager.getState()
  })

  ipcMain.handle('update:download', async () => {
    await updateManager.downloadAvailableUpdate()
    return updateManager.getState()
  })

  ipcMain.on('update:install', async () => {
    await updateManager.install()
  })
}
