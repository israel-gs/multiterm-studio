import { useRef, useCallback, useState } from 'react'
import { CardHeader } from './CardHeader'
import { TerminalPanel } from './Terminal'
import { usePanelStore } from '../store/panelStore'

export interface CardRect {
  x: number
  y: number
  w: number
  h: number
  z: number
}

interface Props {
  sessionId: string
  cwd: string
  rect: CardRect
  zoomRef: React.RefObject<number>
  onMove: (id: string, x: number, y: number) => void
  onResize: (id: string, w: number, h: number) => void
  onBringToFront: (id: string) => void
  onClose: (id: string) => void
}

const MIN_W = 300
const MIN_H = 200
const GRID_STEP = 24

function snap(v: number): number {
  return Math.round(v / GRID_STEP) * GRID_STEP
}

export function FloatingCard({
  sessionId,
  cwd,
  rect,
  zoomRef,
  onMove,
  onResize,
  onBringToFront,
  onClose
}: Props): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const clearAttention = usePanelStore((s) => s.clearAttention)
  const [focused, setFocused] = useState(false)

  // Bring to front on any mousedown within the card
  const handleMouseDown = useCallback(() => {
    onBringToFront(sessionId)
  }, [sessionId, onBringToFront])

  // --- DRAG: accounts for canvas zoom, snaps to grid, activates overlays ---
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('button, input')) return

      e.preventDefault()
      const card = cardRef.current
      if (!card) return

      const scale = zoomRef.current ?? 1
      const startX = e.clientX
      const startY = e.clientY

      card.classList.add('floating-card--dragging')
      document.body.classList.add('canvas-interacting')
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent): void => {
        const dx = (ev.clientX - startX) / scale
        const dy = (ev.clientY - startY) / scale
        card.style.transform = `translate(${dx}px, ${dy}px)`
      }

      const onMouseUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)

        const dx = (ev.clientX - startX) / scale
        const dy = (ev.clientY - startY) / scale
        const newX = snap(rect.x + dx)
        const newY = snap(rect.y + dy)

        // Commit to DOM before React re-render (prevents flash)
        card.style.left = `${newX}px`
        card.style.top = `${newY}px`
        card.style.transform = ''
        card.classList.remove('floating-card--dragging')
        document.body.classList.remove('canvas-interacting')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        onMove(sessionId, newX, newY)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sessionId, rect.x, rect.y, zoomRef, onMove]
  )

  // --- RESIZE: accounts for canvas zoom, snaps to grid ---
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: 'se' | 'e' | 's') => {
      e.preventDefault()
      e.stopPropagation()

      const card = cardRef.current
      if (!card) return

      const scale = zoomRef.current ?? 1
      const startX = e.clientX
      const startY = e.clientY
      const startW = rect.w
      const startH = rect.h

      const cursorMap = { se: 'nwse-resize', e: 'ew-resize', s: 'ns-resize' }
      card.classList.add('floating-card--resizing')
      document.body.classList.add('canvas-interacting')
      document.body.style.cursor = cursorMap[direction]
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent): void => {
        let newW = startW
        let newH = startH

        if (direction === 'e' || direction === 'se') {
          newW = Math.max(MIN_W, startW + (ev.clientX - startX) / scale)
        }
        if (direction === 's' || direction === 'se') {
          newH = Math.max(MIN_H, startH + (ev.clientY - startY) / scale)
        }

        card.style.width = `${newW}px`
        card.style.height = `${newH}px`
      }

      const onMouseUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)

        let newW = startW
        let newH = startH

        if (direction === 'e' || direction === 'se') {
          newW = Math.max(MIN_W, snap(startW + (ev.clientX - startX) / scale))
        }
        if (direction === 's' || direction === 'se') {
          newH = Math.max(MIN_H, snap(startH + (ev.clientY - startY) / scale))
        }

        card.style.width = `${newW}px`
        card.style.height = `${newH}px`
        card.classList.remove('floating-card--resizing')
        document.body.classList.remove('canvas-interacting')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        onResize(sessionId, newW, newH)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sessionId, rect.w, rect.h, zoomRef, onResize]
  )

  // --- KEYBOARD NAVIGATION ---
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.target !== cardRef.current) return

      const step = GRID_STEP

      if (e.shiftKey) {
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault()
            onResize(sessionId, Math.max(MIN_W, rect.w + step), rect.h)
            break
          case 'ArrowLeft':
            e.preventDefault()
            onResize(sessionId, Math.max(MIN_W, rect.w - step), rect.h)
            break
          case 'ArrowDown':
            e.preventDefault()
            onResize(sessionId, rect.w, Math.max(MIN_H, rect.h + step))
            break
          case 'ArrowUp':
            e.preventDefault()
            onResize(sessionId, rect.w, Math.max(MIN_H, rect.h - step))
            break
        }
      } else {
        switch (e.key) {
          case 'ArrowRight':
            e.preventDefault()
            onMove(sessionId, rect.x + step, rect.y)
            break
          case 'ArrowLeft':
            e.preventDefault()
            onMove(sessionId, rect.x - step, rect.y)
            break
          case 'ArrowDown':
            e.preventDefault()
            onMove(sessionId, rect.x, rect.y + step)
            break
          case 'ArrowUp':
            e.preventDefault()
            onMove(sessionId, rect.x, rect.y - step)
            break
        }
      }
    },
    [sessionId, rect.x, rect.y, rect.w, rect.h, onMove, onResize]
  )

  return (
    <div
      ref={cardRef}
      className={`floating-card${focused ? ' floating-card--focused' : ''}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: rect.z
      }}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!cardRef.current?.contains(e.relatedTarget as Node)) {
          setFocused(false)
        }
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Drag handle wraps the header */}
      <div data-drag-handle onMouseDown={handleDragStart}>
        <CardHeader sessionId={sessionId} onClose={() => onClose(sessionId)} />
      </div>

      <div
        className="floating-card-body"
        onClick={() => clearAttention(sessionId)}
        onFocus={() => clearAttention(sessionId)}
      >
        <div className="floating-card-inner">
          <TerminalPanel sessionId={sessionId} cwd={cwd} />
        </div>
      </div>

      {/* Resize handles */}
      <div
        className="resize-handle resize-handle--e"
        onMouseDown={(e) => handleResizeStart(e, 'e')}
      />
      <div
        className="resize-handle resize-handle--s"
        onMouseDown={(e) => handleResizeStart(e, 's')}
      />
      <div
        className="resize-handle resize-handle--se"
        onMouseDown={(e) => handleResizeStart(e, 'se')}
      />
    </div>
  )
}
