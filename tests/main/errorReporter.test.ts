/** @vitest-environment node */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  reportError,
  setErrorSink,
  _resetErrorThrottleForTests
} from '../../src/main/errorReporter'

/**
 * Persistence failures are non-fatal on purpose, so this is the only thing
 * standing between a failed save and the user never finding out.
 */

const sink = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  _resetErrorThrottleForTests()
  setErrorSink(sink)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  setErrorSink(null)
  vi.restoreAllMocks()
})

describe('reportError', () => {
  it('forwards the message to the sink', () => {
    reportError('layout-save', 'Could not save the layout')

    expect(sink).toHaveBeenCalledWith({ message: 'Could not save the layout', detail: undefined })
  })

  it('includes the cause as detail', () => {
    reportError('layout-save', 'Could not save the layout', new Error('EACCES'))

    expect(sink).toHaveBeenCalledWith({
      message: 'Could not save the layout',
      detail: 'EACCES'
    })
  })

  it('accepts a non-Error cause', () => {
    reportError('layout-save', 'nope', 'a string reason')

    expect(sink).toHaveBeenCalledWith({ message: 'nope', detail: 'a string reason' })
  })

  it('always logs, even when the report is throttled', () => {
    reportError('layout-save', 'first')
    reportError('layout-save', 'second')

    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('reports the same key only once inside the throttle window', () => {
    // Saves are debounced but frequent; a failing disk must not produce a
    // notification per save.
    reportError('layout-save', 'failed')
    reportError('layout-save', 'failed')
    reportError('layout-save', 'failed')

    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('reports again once the throttle window has passed', () => {
    vi.useFakeTimers()
    try {
      reportError('layout-save', 'failed')
      vi.advanceTimersByTime(31_000)
      reportError('layout-save', 'failed')

      expect(sink).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('throttles each cause independently', () => {
    reportError('layout-save', 'a')
    reportError('settings-save', 'b')

    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('does not throw when no sink is registered', () => {
    setErrorSink(null)

    expect(() => reportError('layout-save', 'failed')).not.toThrow()
  })
})
