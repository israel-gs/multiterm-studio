export const DEFAULT_SCROLLBACK_BYTES = 8 * 1024 * 1024
export const MIN_SCROLLBACK_BYTES = 16 * 1024
export const MAX_SCROLLBACK_BYTES = 64 * 1024 * 1024

/**
 * Bounded ring buffer for PTY scrollback.
 *
 * Maintains a fixed-capacity internal Buffer. When the capacity is exceeded,
 * the oldest bytes are overwritten first (classic circular buffer semantics).
 * `replay()` reconstructs the contents in write order as a single Buffer.
 */
export class RingBuffer {
  private storage: Buffer
  private head: number = 0 // next write position (oldest data starts here after wrap)
  private used: number = 0 // how many bytes are currently valid

  constructor(capacityBytes: number = DEFAULT_SCROLLBACK_BYTES) {
    this.storage = Buffer.allocUnsafe(capacityBytes)
  }

  get capacity(): number {
    return this.storage.length
  }

  write(chunk: Buffer | string): void {
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    const cap = this.storage.length

    if (data.length === 0) return

    if (data.length >= cap) {
      // Chunk is at least as large as the whole buffer — only the last `cap` bytes survive.
      data.copy(this.storage, 0, data.length - cap)
      this.head = 0
      this.used = cap
      return
    }

    // How many bytes can we fit before wrapping?
    const tail = (this.head + this.used) % cap
    const spaceAtEnd = cap - tail

    if (data.length <= spaceAtEnd) {
      // Fits without wrapping
      data.copy(this.storage, tail)
    } else {
      // Wraps around
      const firstPart = spaceAtEnd
      data.copy(this.storage, tail, 0, firstPart)
      data.copy(this.storage, 0, firstPart)
    }

    if (this.used + data.length > cap) {
      // We overwrote some old bytes — advance head past them.
      const overflow = this.used + data.length - cap
      this.head = (this.head + overflow) % cap
      this.used = cap
    } else {
      this.used += data.length
    }
  }

  replay(): Buffer {
    if (this.used === 0) return Buffer.alloc(0)

    const cap = this.storage.length
    const out = Buffer.allocUnsafe(this.used)

    if (this.head + this.used <= cap) {
      // Contiguous segment starting at head
      this.storage.copy(out, 0, this.head, this.head + this.used)
    } else {
      // Wraps around: two segments
      const firstLen = cap - this.head
      this.storage.copy(out, 0, this.head, cap)
      this.storage.copy(out, firstLen, 0, this.used - firstLen)
    }

    return out
  }

  resize(newCapacityBytes: number): void {
    const current = this.replay()
    this.storage = Buffer.allocUnsafe(newCapacityBytes)
    this.head = 0
    this.used = 0

    // If existing content exceeds new cap, keep only the most-recent bytes.
    if (current.length <= newCapacityBytes) {
      current.copy(this.storage, 0)
      this.used = current.length
    } else {
      const kept = current.slice(current.length - newCapacityBytes)
      kept.copy(this.storage, 0)
      this.used = newCapacityBytes
    }
  }
}
