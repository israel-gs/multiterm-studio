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
/**
 * The notification currently on screen for each session.
 *
 * A terminal that keeps re-prompting would otherwise stack a notification per
 * event in the OS centre; superseding the previous one keeps it to at most one
 * per session, always showing the latest prompt.
 */
const activeNotifications = new Map<string, Notification>()

export function handleAttentionEvent(
  win: BrowserWindow,
  sessionId: string,
  panelTitle: string,
  snippet: string
): void {
  if (win.isFocused()) return

  activeNotifications.get(sessionId)?.close()

  const n = new Notification({
    title: `Input needed - ${panelTitle}`,
    body: snippet
  })

  n.on('click', () => {
    activeNotifications.delete(sessionId)
    win.show()
    win.focus()
    win.webContents.send('panel:focus', sessionId)
  })
  n.on('close', () => {
    if (activeNotifications.get(sessionId) === n) activeNotifications.delete(sessionId)
  })

  activeNotifications.set(sessionId, n)
  n.show()
}

/** Dismisses any notification still showing for a session that is going away. */
export function clearAttentionNotification(sessionId: string): void {
  activeNotifications.get(sessionId)?.close()
  activeNotifications.delete(sessionId)
}
