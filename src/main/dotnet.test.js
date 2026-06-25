import { describe, it, expect, beforeEach } from 'vitest'
import { resolveDotnetPath, _resetDotnetPathCache } from './dotnet.js'

describe('resolveDotnetPath', () => {
  beforeEach(() => _resetDotnetPathCache())

  it('resolves to a non-empty command string', async () => {
    const p = await resolveDotnetPath()
    expect(typeof p).toBe('string')
    expect(p.length).toBeGreaterThan(0)
  })

  it('memoizes — repeated calls return the same value', async () => {
    const a = await resolveDotnetPath()
    const b = await resolveDotnetPath()
    expect(b).toBe(a)
  })
})
