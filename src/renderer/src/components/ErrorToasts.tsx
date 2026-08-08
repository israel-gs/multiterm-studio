import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface Toast {
  id: number
  message: string
  detail?: string
}

/** How long a toast stays before dismissing itself. */
const DISMISS_MS = 8000

let nextId = 1

/**
 * Surfaces failures the main process reports.
 *
 * Saving a layout or a setting is deliberately non-fatal, which used to mean
 * the error vanished entirely — a read-only volume discarded the user's work
 * with no indication. These are rare and already throttled per cause in the
 * main process, so a corner toast is enough.
 */
export function ErrorToasts(): React.JSX.Element | null {
  const [toasts, setToasts] = useState<Toast[]>([])

  useEffect(() => {
    return window.electronAPI.onAppError((error) => {
      const toast: Toast = { id: nextId++, ...error }
      setToasts((prev) => [...prev, toast])
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, DISMISS_MS)
    })
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <AlertTriangle className="toast-icon" size={16} strokeWidth={1.5} aria-hidden="true" />
          <div className="toast-body">
            <div className="toast-message">{toast.message}</div>
            {toast.detail && <div className="toast-detail">{toast.detail}</div>}
          </div>
          <button
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}
