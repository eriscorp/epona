import { describe, it, expect } from 'vitest'
import { basenameOfPath } from './pathBasename.js'

describe('basenameOfPath', () => {
  it('returns the last segment of a POSIX path', () => {
    expect(basenameOfPath('/home/user/ceridwen')).toBe('ceridwen')
  })

  it('returns the last segment of a Windows path', () => {
    expect(basenameOfPath('D:\\Dark Ages\\ceridwen')).toBe('ceridwen')
  })

  it('handles mixed separators', () => {
    expect(basenameOfPath('D:\\repos/server\\worlds/local')).toBe('local')
  })

  it('strips trailing separators (both styles)', () => {
    expect(basenameOfPath('/home/user/world/')).toBe('world')
    expect(basenameOfPath('D:\\home\\world\\')).toBe('world')
    expect(basenameOfPath('/home/user/world///')).toBe('world')
  })

  it('returns a single segment unchanged', () => {
    expect(basenameOfPath('ceridwen')).toBe('ceridwen')
  })
})
