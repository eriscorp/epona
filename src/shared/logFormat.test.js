import { describe, it, expect } from 'vitest'
import { formatLogLines } from './logFormat.js'

describe('formatLogLines', () => {
  it('passes stdout text through untagged', () => {
    expect(formatLogLines([{ stream: 'stdout', text: 'hello world' }])).toBe('hello world')
  })

  it('tags stderr lines', () => {
    expect(formatLogLines([{ stream: 'stderr', text: 'boom' }])).toBe('[stderr] boom')
  })

  it('tags exit lines', () => {
    expect(formatLogLines([{ stream: 'exit', text: 'code 1' }])).toBe('[exit] code 1')
  })

  it('joins mixed records with newlines, preserving order', () => {
    const lines = [
      { stream: 'stdout', text: 'a' },
      { stream: 'stderr', text: 'b' },
      { stream: 'exit', text: 'c' }
    ]
    expect(formatLogLines(lines)).toBe('a\n[stderr] b\n[exit] c')
  })

  it('returns an empty string for no lines', () => {
    expect(formatLogLines([])).toBe('')
  })
})
