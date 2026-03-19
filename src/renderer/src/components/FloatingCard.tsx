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

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

interface Props {
  sessionId: string
  cwd: string
  rect: CardRect
  zoomRef: React.RefObject<number>
  selected?: boolean
  onSelect?: (id: string, shiftKey: boolean) => void
  onMove: (id: string, x: number, y: number) => void
  onResize: (id: string, w: number, h: number) => void
  onResizeWithMove?: (id: string, x: number, y: number, w: number, h: number) => void
  onBringToFront: (id: string) => void
  onClose: (id: string) => void
  onGroupDragContext?: (id: string) => Array<{ id: string; x: number; y: number }> | null
  onGroupMove?: (moves: Array<{ id: string; x: number; y: number }>) => void
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
  selected,
  onSelect,
  onMove,
  onResize,
  onResizeWithMove,
  onBringToFront,
  onClose,
  onGroupDragContext,
  onGroupMove
}: Props): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null)
  const clearAttention = usePanelStore((s) => s.clearAttention)
  const [focused, setFocused] = useState(false)

  // Bring to front + select on any mousedown within the card
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      onBringToFront(sessionId)
      onSelect?.(sessionId, e.shiftKey)
    },
    [sessionId, onBringToFront, onSelect]
  )

  // --- DRAG: accounts for canvas zoom, snaps to grid, supports group drag ---
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

      // Get group context (peer cards in selection)
      const peers = onGroupDragContext?.(sessionId) ?? null
      const peerEls: Array<{ id: string; startX: number; startY: number; el: HTMLDivElement }> = []
      if (peers) {
        for (const p of peers) {
          const el = document.querySelector(`[data-card-id="${p.id}"]`) as HTMLDivElement | null
          if (el) peerEls.push({ id: p.id, startX: p.x, startY: p.y, el })
        }
      }

      card.classList.add('floating-card--dragging')
      document.body.classList.add('canvas-interacting')
      document.body.style.cursor = 'grabbing'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent): void => {
        const dx = (ev.clientX - startX) / scale
        const dy = (ev.clientY - startY) / scale
        card.style.transform = `translate(${dx}px, ${dy}px)`
        for (const p of peerEls) {
          p.el.style.transform = `translate(${dx}px, ${dy}px)`
        }
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

        if (peerEls.length > 0 && onGroupMove) {
          const moves = [{ id: sessionId, x: newX, y: newY }]
          for (const p of peerEls) {
            const px = snap(p.startX + dx)
            const py = snap(p.startY + dy)
            p.el.style.left = `${px}px`
            p.el.style.top = `${py}px`
            p.el.style.transform = ''
            moves.push({ id: p.id, x: px, y: py })
          }
          onGroupMove(moves)
        } else {
          onMove(sessionId, newX, newY)
        }
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sessionId, rect.x, rect.y, zoomRef, onMove, onGroupDragContext, onGroupMove]
  )

  // --- RESIZE: all 8 directions, accounts for canvas zoom, snaps to grid ---
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, direction: ResizeDir) => {
      e.preventDefault()
      e.stopPropagation()

      const card = cardRef.current
      if (!card) return

      const scale = zoomRef.current ?? 1
      const startMouseX = e.clientX
      const startMouseY = e.clientY
      const startW = rect.w
      const startH = rect.h
      const startCardX = rect.x
      const startCardY = rect.y

      const hasN = direction.includes('n')
      const hasS = direction.includes('s')
      const hasE = direction.includes('e')
      const hasW = direction.includes('w')
      const needsMove = hasN || hasW

      const cursorMap: Record<string, string> = {
        n: 'ns-resize',
        s: 'ns-resize',
        e: 'ew-resize',
        w: 'ew-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        nw: 'nwse-resize',
        se: 'nwse-resize'
      }

      card.classList.add('floating-card--resizing')
      document.body.classList.add('canvas-interacting')
      document.body.style.cursor = cursorMap[direction]
      document.body.style.userSelect = 'none'

      const compute = (
        ev: MouseEvent
      ): { newW: number; newH: number; newX: number; newY: number } => {
        const dx = (ev.clientX - startMouseX) / scale
        const dy = (ev.clientY - startMouseY) / scale
        let newW = startW
        let newH = startH
        let newX = startCardX
        let newY = startCardY

        if (hasE) newW = Math.max(MIN_W, startW + dx)
        if (hasW) {
          newW = Math.max(MIN_W, startW - dx)
          newX = startCardX + startW - newW
        }
        if (hasS) newH = Math.max(MIN_H, startH + dy)
        if (hasN) {
          newH = Math.max(MIN_H, startH - dy)
          newY = startCardY + startH - newH
        }

        return { newW, newH, newX, newY }
      }

      const onMouseMove = (ev: MouseEvent): void => {
        const { newW, newH, newX, newY } = compute(ev)
        card.style.width = `${newW}px`
        card.style.height = `${newH}px`
        if (needsMove) {
          card.style.left = `${newX}px`
          card.style.top = `${newY}px`
        }
      }

      const onMouseUp = (ev: MouseEvent): void => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)

        const { newW: rawW, newH: rawH } = compute(ev)
        const snappedW = Math.max(MIN_W, snap(rawW))
        const snappedH = Math.max(MIN_H, snap(rawH))

        // For N/W: recalculate position based on snapped size (keeps opposite edge pinned)
        let finalX = startCardX
        let finalY = startCardY
        if (hasW) finalX = startCardX + startW - snappedW
        if (hasN) finalY = startCardY + startH - snappedH

        card.style.width = `${snappedW}px`
        card.style.height = `${snappedH}px`
        if (needsMove) {
          card.style.left = `${finalX}px`
          card.style.top = `${finalY}px`
        }
        card.classList.remove('floating-card--resizing')
        document.body.classList.remove('canvas-interacting')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''

        if (needsMove && onResizeWithMove) {
          onResizeWithMove(sessionId, finalX, finalY, snappedW, snappedH)
        } else {
          onResize(sessionId, snappedW, snappedH)
        }
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [sessionId, rect.w, rect.h, rect.x, rect.y, zoomRef, onResize, onResizeWithMove]
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

  const classNames = [
    'floating-card',
    focused && 'floating-card--focused',
    selected && 'floating-card--selected'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={cardRef}
      data-card-id={sessionId}
      className={classNames}
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

      {/* Resize handles — all 8 directions */}
      <div
        className="resize-handle resize-handle--n"
        onMouseDown={(e) => handleResizeStart(e, 'n')}
      />
      <div
        className="resize-handle resize-handle--s"
        onMouseDown={(e) => handleResizeStart(e, 's')}
      />
      <div
        className="resize-handle resize-handle--e"
        onMouseDown={(e) => handleResizeStart(e, 'e')}
      />
      <div
        className="resize-handle resize-handle--w"
        onMouseDown={(e) => handleResizeStart(e, 'w')}
      />
      <div
        className="resize-handle resize-handle--ne"
        onMouseDown={(e) => handleResizeStart(e, 'ne')}
      />
      <div
        className="resize-handle resize-handle--nw"
        onMouseDown={(e) => handleResizeStart(e, 'nw')}
      />
      <div
        className="resize-handle resize-handle--se"
        onMouseDown={(e) => handleResizeStart(e, 'se')}
      />
      <div
        className="resize-handle resize-handle--sw"
        onMouseDown={(e) => handleResizeStart(e, 'sw')}
      />
    </div>
  )
}
