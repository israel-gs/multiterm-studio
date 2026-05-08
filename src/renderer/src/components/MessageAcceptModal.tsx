import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, X } from 'lucide-react'
import { useBridgeStore, getPendingMessages } from '../store/bridgeStore'
import type { PendingMessage } from '../store/bridgeStore'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  paneId: string
  onClose: () => void
}

// ── Row component ─────────────────────────────────────────────────────────────

interface RowProps {
  message: PendingMessage
  onAccepted: () => void
  onDeclined: () => void
}

function MessageRow({ message, onAccepted, onDeclined }: RowProps): React.JSX.Element {
  const [responseText, setResponseText] = useState('')
  const isSend = message.kind === 'send'
  const senderLabel = message.fromAlias ?? message.fromPane

  function handleAccept(): void {
    const response = responseText.trim() !== '' ? responseText.trim() : undefined
    window.electronAPI
      .bridgeAccept(message.messageId, response)
      .then(onAccepted)
      .catch(() => {
        // Error from the main process does not prevent the UI from updating —
        // the chip will remain visible if bridgeMessageResolved is not called.
      })
  }

  function handleDecline(): void {
    window.electronAPI
      .bridgeDecline(message.messageId)
      .then(onDeclined)
      .catch(() => {
        // Same rationale as handleAccept above.
      })
  }

  return (
    <div className="bridge-msg-row">
      <div className="bridge-msg-meta">
        <span className="bridge-msg-sender">{senderLabel}</span>
        <span className={`bridge-msg-kind bridge-msg-kind--${message.kind}`}>{message.kind}</span>
      </div>

      <p className="bridge-msg-body">{message.body}</p>

      <div className="bridge-msg-actions">
        {isSend && (
          <textarea
            className="bridge-msg-response"
            placeholder="Optional response..."
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            rows={2}
          />
        )}

        <div className="bridge-msg-buttons">
          <button
            className="bridge-msg-btn bridge-msg-btn--accept"
            aria-label="Accept"
            onClick={handleAccept}
          >
            <Check size={14} strokeWidth={1.5} />
            Accept
          </button>

          {isSend && (
            <button
              className="bridge-msg-btn bridge-msg-btn--decline"
              aria-label="Decline"
              onClick={handleDecline}
            >
              <X size={14} strokeWidth={1.5} />
              Decline
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function MessageAcceptModal({ paneId, onClose }: Props): React.JSX.Element | null {
  const bridgeMessageResolved = useBridgeStore((s) => s.bridgeMessageResolved)
  const messages = getPendingMessages(paneId)

  // Close the modal automatically when the pending list empties.
  if (messages.length === 0) {
    // Schedule close on next tick so React does not call onClose during render.
    setTimeout(onClose, 0)
    return null
  }

  const modal = (
    <div className="bridge-modal-backdrop" onClick={onClose}>
      <div
        className="bridge-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pending bridge messages"
      >
        <div className="bridge-modal-header">
          <span className="bridge-modal-title">Pending Messages</span>
          <button className="bridge-modal-close" aria-label="Close" onClick={onClose}>
            <X size={12} strokeWidth={1.5} />
          </button>
        </div>

        <div className="bridge-modal-body">
          {messages.map((msg) => (
            <MessageRow
              key={msg.messageId}
              message={msg}
              onAccepted={() => bridgeMessageResolved({ paneId, messageId: msg.messageId })}
              onDeclined={() => bridgeMessageResolved({ paneId, messageId: msg.messageId })}
            />
          ))}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
