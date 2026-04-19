/** @vitest-environment node */
import { describe, test, expect } from 'vitest'
import {
  RingBuffer,
  DEFAULT_SCROLLBACK_BYTES,
  MIN_SCROLLBACK_BYTES,
  MAX_SCROLLBACK_BYTES
} from '../../../src/main/sidecar/ring-buffer'

describe('RingBuffer — constants', () => {
  test('DEFAULT_SCROLLBACK_BYTES is 8 MB', () => {
    expect(DEFAULT_SCROLLBACK_BYTES).toBe(8 * 1024 * 1024)
  })

  test('MIN_SCROLLBACK_BYTES is 16 KB', () => {
    expect(MIN_SCROLLBACK_BYTES).toBe(16 * 1024)
  })

  test('MAX_SCROLLBACK_BYTES is 64 MB', () => {
    expect(MAX_SCROLLBACK_BYTES).toBe(64 * 1024 * 1024)
  })
})

describe('RingBuffer — basic write and replay', () => {
  test('replay on empty buffer returns empty Buffer', () => {
    const buf = new RingBuffer(1024)
    const result = buf.replay()
    expect(result).toBeInstanceOf(Buffer)
    expect(result.length).toBe(0)
  })

  test('replay after sequential string writes returns them in order', () => {
    const buf = new RingBuffer(1024)
    buf.write('A')
    buf.write('B')
    buf.write('C')
    expect(buf.replay().toString()).toBe('ABC')
  })

  test('replay after Buffer writes returns correct bytes', () => {
    const buf = new RingBuffer(1024)
    buf.write(Buffer.from('hello'))
    buf.write(Buffer.from(' world'))
    expect(buf.replay().toString()).toBe('hello world')
  })

  test('writes within cap return all bytes in replay', () => {
    const cap = 8 * 1024 * 1024 // 8 MB
    const buf = new RingBuffer(cap)
    const chunk = Buffer.alloc(4 * 1024 * 1024, 0x41) // 4 MB of 'A'
    buf.write(chunk)
    const result = buf.replay()
    expect(result.length).toBe(4 * 1024 * 1024)
    expect(result.every((b) => b === 0x41)).toBe(true)
  })
})

describe('RingBuffer — overflow wrapping', () => {
  test('oldest bytes are overwritten when cap is exceeded', () => {
    const cap = 4 // 4 bytes capacity
    const buf = new RingBuffer(cap)
    buf.write('AAAA') // fills the buffer
    buf.write('BB') // overflows by 2 — oldest 2 bytes ('AA') should be gone
    const result = buf.replay()
    expect(result.length).toBe(cap)
    expect(result.toString()).toBe('AABB')
  })

  test('overflow scenario: 1 MB cap + 256 KB overflow — latest 1 MB is preserved', () => {
    const cap = 1024 * 1024 // 1 MB
    const buf = new RingBuffer(cap)
    // Write 1 MB with marker byte 0x01
    buf.write(Buffer.alloc(cap, 0x01))
    // Write 256 KB with marker byte 0x02
    const overflow = Buffer.alloc(256 * 1024, 0x02)
    buf.write(overflow)
    const result = buf.replay()
    expect(result.length).toBe(cap)
    // Last 256 KB must be 0x02
    const tail = result.slice(cap - 256 * 1024)
    expect(tail.every((b) => b === 0x02)).toBe(true)
    // First (1 MB - 256 KB) bytes must be 0x01
    const head = result.slice(0, cap - 256 * 1024)
    expect(head.every((b) => b === 0x01)).toBe(true)
  })

  test('write chunk larger than cap — only last cap bytes survive', () => {
    const cap = 8
    const buf = new RingBuffer(cap)
    buf.write('ABCDEFGHIJKLMNOP') // 16 chars, cap is 8
    const result = buf.replay()
    expect(result.length).toBe(cap)
    expect(result.toString()).toBe('IJKLMNOP')
  })
})

describe('RingBuffer — resize', () => {
  test('resize to larger cap preserves existing content', () => {
    const buf = new RingBuffer(16)
    buf.write('hello')
    buf.resize(64)
    expect(buf.replay().toString()).toBe('hello')
  })

  test('resize to smaller cap truncates oldest bytes', () => {
    const buf = new RingBuffer(16)
    buf.write('ABCDEFGHIJ') // 10 bytes
    buf.resize(4)
    const result = buf.replay()
    expect(result.length).toBe(4)
    expect(result.toString()).toBe('GHIJ')
  })

  test('resize to exact current content size preserves all bytes', () => {
    const buf = new RingBuffer(16)
    buf.write('EXACT')
    buf.resize(5)
    expect(buf.replay().toString()).toBe('EXACT')
  })
})

describe('RingBuffer — per-instance isolation', () => {
  test('writes to one instance do not appear in another', () => {
    const a = new RingBuffer(1024)
    const b = new RingBuffer(1024)
    a.write('hello')
    expect(b.replay().length).toBe(0)
  })

  test('separate instances track their own content independently', () => {
    const a = new RingBuffer(1024)
    const b = new RingBuffer(1024)
    a.write('session-A')
    b.write('session-B')
    expect(a.replay().toString()).toBe('session-A')
    expect(b.replay().toString()).toBe('session-B')
  })
})
