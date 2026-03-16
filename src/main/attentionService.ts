import { Notification, BrowserWindow } from 'electron'

/**
 * Fires a native OS notification when the app is not focused.
 * Clicking the notification restores the window and focuses the triggering panel.
 *
 * @param win - The main BrowserWindow
 * @param sessionId - The PTY session ID that triggered the attention event
 * @param panelTitle - The human-readable title of the panel (e.g. "Terminal", "Build")
 * @param snippet - Short text snippet from the PTY output (first ~120 chars)
 */
export function handleAttentionEvent(
  win: BrowserWindow,
  sessionId: string,
  panelTitle: string,
  snippet: string
): void {
  if (win.isFocused()) return

  const n = new Notification({
    title: `Input needed - ${panelTitle}`,
    body: snippet
  })

  n.on('click', () => {
    win.show()
    win.focus()
    win.webContents.send('panel:focus', sessionId)
  })

  n.show()
}
