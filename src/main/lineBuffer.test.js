import { describe, it, expect, vi } from 'vitest'
import { createLineBuffer } from './lineBuffer.js'

describe('createLineBuffer', () => {
  it('emits each complete line as it arrives', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('hello\nworld\n')
    expect(onLine).toHaveBeenNthCalledWith(1, 'hello')
    expect(onLine).toHaveBeenNthCalledWith(2, 'world')
  })

  it('accumulates partial chunks until a newline arrives', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('hel')
    expect(onLine).not.toHaveBeenCalled()
    buf.push('lo\n')
    expect(onLine).toHaveBeenCalledWith('hello')
  })

  it('handles multiple lines in a single chunk', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('a\nb\nc\n')
    expect(onLine.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
  })

  it('strips a trailing \\r so CRLF-terminated lines emit clean', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('hello\r\nworld\r\n')
    expect(onLine.mock.calls.map((c) => c[0])).toEqual(['hello', 'world'])
  })

  it('accepts Buffer chunks and decodes as utf-8', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push(Buffer.from('café\n', 'utf-8'))
    expect(onLine).toHaveBeenCalledWith('café')
  })

  it('emits nothing on flush when the buffer is empty', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.flush()
    expect(onLine).not.toHaveBeenCalled()
  })

  it('emits the tail line on flush when the last chunk lacked a newline', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('complete\npartial')
    expect(onLine).toHaveBeenCalledTimes(1)
    buf.flush()
    expect(onLine).toHaveBeenNthCalledWith(2, 'partial')
  })

  it('flush strips a trailing \\r from the tail as well', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('partial\r')
    buf.flush()
    expect(onLine).toHaveBeenCalledWith('partial')
  })

  it('handles lines that span multiple chunks split mid-word', () => {
    const onLine = vi.fn()
    const buf = createLineBuffer(onLine)

    buf.push('hel')
    buf.push('lo wo')
    buf.push('rld\n')
    expect(onLine).toHaveBeenCalledWith('hello world')
  })
})
