import { describe, it, expect, vi, afterEach } from 'vitest'
import { isProcessAlive } from './processAlive.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isProcessAlive', () => {
  it('reports our own process as alive', () => {
    expect(isProcessAlive(process.pid)).toBe(true)
  })

  it('rejects non-pids without probing', () => {
    const kill = vi.spyOn(process, 'kill')
    for (const bad of [0, -1, 1.5, null, undefined, '1234', NaN]) {
      expect(isProcessAlive(bad)).toBe(false)
    }
    expect(kill).not.toHaveBeenCalled()
  })

  it('treats ESRCH as dead', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    })
    expect(isProcessAlive(4321)).toBe(false)
  })

  it('treats EPERM as alive — it exists, we just may not signal it', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    })
    expect(isProcessAlive(4321)).toBe(true)
  })

  it('treats any other failure as dead', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(isProcessAlive(4321)).toBe(false)
  })
})
