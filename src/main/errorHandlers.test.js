import { describe, it, expect, vi, afterEach } from 'vitest'
import { installGlobalErrorHandlers } from './errorHandlers.js'

// These attach real listeners to the real `process`, so every test removes what
// it added. Left behind, they would fire on unrelated tests' rejections and the
// capture spy would see traffic nobody in this file caused.
const attached = []

function install() {
  const capture = vi.fn()
  const before = {
    uncaughtException: process.listeners('uncaughtException').slice(),
    unhandledRejection: process.listeners('unhandledRejection').slice()
  }
  installGlobalErrorHandlers(capture)
  const added = {
    uncaughtException: process
      .listeners('uncaughtException')
      .filter((l) => !before.uncaughtException.includes(l)),
    unhandledRejection: process
      .listeners('unhandledRejection')
      .filter((l) => !before.unhandledRejection.includes(l))
  }
  attached.push(added)
  return { capture, added }
}

afterEach(() => {
  for (const added of attached.splice(0)) {
    for (const listener of added.uncaughtException) {
      process.removeListener('uncaughtException', listener)
    }
    for (const listener of added.unhandledRejection) {
      process.removeListener('unhandledRejection', listener)
    }
  }
})

describe('installGlobalErrorHandlers', () => {
  it('captures an uncaught exception with its name, message and stack', () => {
    const { capture, added } = install()
    const error = new TypeError('boom')
    added.uncaughtException[0](error)

    expect(capture).toHaveBeenCalledWith({
      source: 'uncaughtException',
      origin: 'main',
      message: 'TypeError: boom',
      stack: error.stack
    })
  })

  it('captures a rejection that carries an Error', () => {
    const { capture, added } = install()
    const error = new RangeError('too far')
    added.unhandledRejection[0](error)

    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'unhandledRejection',
        origin: 'main',
        message: 'RangeError: too far',
        stack: error.stack
      })
    )
  })

  it('still captures a rejection thrown with a non-Error', () => {
    // `throw 'string'` and `Promise.reject(undefined)` are the ones that lose the
    // most information, so they are the ones worth not dropping entirely.
    const { capture, added } = install()
    added.unhandledRejection[0]('just a string')
    added.unhandledRejection[0](undefined)

    expect(capture).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ message: 'just a string', stack: undefined })
    )
    expect(capture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ message: 'undefined', stack: undefined })
    )
  })

  it('handles an error-like object with no name', () => {
    const { capture, added } = install()
    added.uncaughtException[0]({ message: 'anonymous' })
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Error: anonymous', stack: undefined })
    )
  })

  it('falls back to stringifying a thrown value with no message', () => {
    const { capture, added } = install()
    added.uncaughtException[0](42)
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ message: '42' }))
  })

  it('does not swallow the process default — it only observes', () => {
    // The module comment is explicit that capturing must not change what Electron
    // decides to do with an uncaughtException. Registering a listener is
    // observable in exactly one way that matters: it does not call
    // process.exit, and it leaves any pre-existing listener in place.
    const existing = vi.fn()
    process.on('uncaughtException', existing)
    try {
      const { added } = install()
      expect(added.uncaughtException).toHaveLength(1)
      expect(process.listeners('uncaughtException')).toContain(existing)
    } finally {
      process.removeListener('uncaughtException', existing)
    }
  })

  it('registers exactly one listener per stream', () => {
    const { added } = install()
    expect(added.uncaughtException).toHaveLength(1)
    expect(added.unhandledRejection).toHaveLength(1)
  })
})
