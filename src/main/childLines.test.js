import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { pipeChildLines } from './childLines.js'

function makeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('pipeChildLines', () => {
  it('routes complete stdout/stderr lines to the right callbacks', () => {
    const child = makeChild()
    const onStdoutLine = vi.fn()
    const onStderrLine = vi.fn()
    pipeChildLines(child, { onStdoutLine, onStderrLine })
    child.stdout.emit('data', Buffer.from('hello\nworld\n'))
    child.stderr.emit('data', Buffer.from('oops\n'))
    expect(onStdoutLine.mock.calls).toEqual([['hello'], ['world']])
    expect(onStderrLine.mock.calls).toEqual([['oops']])
  })

  it('flushes a trailing partial line and fires onExit after, with code/signal', () => {
    const child = makeChild()
    const lines = []
    const onExit = vi.fn()
    pipeChildLines(child, { onStdoutLine: (l) => lines.push(l), onExit })
    child.stdout.emit('data', Buffer.from('partial')) // no newline
    expect(lines).toEqual([]) // buffered, not yet emitted
    child.emit('exit', 0, null)
    expect(lines).toEqual(['partial']) // flushed on exit
    expect(onExit).toHaveBeenCalledWith(0, null, undefined)
  })

  it('formats a spawn error as a [spawn error] line', () => {
    const child = makeChild()
    const onErrorLine = vi.fn()
    pipeChildLines(child, { onErrorLine })
    child.emit('error', new Error('ENOENT'))
    expect(onErrorLine).toHaveBeenCalledWith('[spawn error] ENOENT')
  })

  it('ends a child that never started: the error line, then onExit once (HTOO-589)', () => {
    // A failed spawn (ENOENT, EACCES) emits 'error' and no 'exit', and has no
    // pid. Without this the caller never untracks it, and Start says "already
    // running" until Epona restarts.
    const child = makeChild()
    const order = []
    const err = new Error('spawn dotnet ENOENT')
    pipeChildLines(child, {
      onStdoutLine: (l) => order.push(['out', l]),
      onErrorLine: (l) => order.push(['line', l]),
      onExit: (...args) => order.push(['exit', ...args])
    })
    child.stdout.emit('data', Buffer.from('partial'))
    child.emit('error', err)
    child.emit('exit', null, null) // if Node ever sends one too, it is ignored
    expect(order).toEqual([
      ['line', '[spawn error] spawn dotnet ENOENT'],
      ['out', 'partial'],
      ['exit', null, null, err]
    ])
  })

  it('does not end a child that started when it reports an error', () => {
    // An 'error' from a running process (a failed kill) is only a line.
    const child = makeChild()
    child.pid = 1234
    const onExit = vi.fn()
    const onErrorLine = vi.fn()
    pipeChildLines(child, { onExit, onErrorLine })
    child.emit('error', new Error('kill EPERM'))
    expect(onErrorLine).toHaveBeenCalledWith('[spawn error] kill EPERM')
    expect(onExit).not.toHaveBeenCalled()
    child.emit('exit', 0, null)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('tolerates missing optional callbacks and absent stdio streams', () => {
    const child = new EventEmitter() // no stdout/stderr
    expect(() => {
      pipeChildLines(child, {})
      child.emit('exit', 1, 'SIGKILL')
      child.emit('error', new Error('x'))
    }).not.toThrow()
  })
})
