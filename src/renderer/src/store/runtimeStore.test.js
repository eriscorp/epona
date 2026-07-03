import { describe, it, expect, beforeEach } from 'vitest'
import { useRuntime, LOG_CAP } from './runtimeStore.js'

const reset = () => useRuntime.setState({ hybrasylLog: [], instanceLogs: {} })

describe('runtimeStore', () => {
  beforeEach(reset)

  it('appends hybrasyl lines with stream + text in order', () => {
    useRuntime.getState().appendHybrasyl('stdout', 'hello')
    useRuntime.getState().appendHybrasyl('stderr', 'oops')
    expect(useRuntime.getState().hybrasylLog).toEqual([
      { stream: 'stdout', text: 'hello' },
      { stream: 'stderr', text: 'oops' }
    ])
  })

  it('caps the hybrasyl buffer at LOG_CAP, dropping the oldest', () => {
    for (let i = 0; i < LOG_CAP + 5; i++) {
      useRuntime.getState().appendHybrasyl('stdout', `line ${i}`)
    }
    const log = useRuntime.getState().hybrasylLog
    expect(log.length).toBe(LOG_CAP)
    expect(log[0].text).toBe('line 5') // first five dropped
    expect(log[log.length - 1].text).toBe(`line ${LOG_CAP + 4}`)
  })

  it('clears the hybrasyl buffer', () => {
    useRuntime.getState().appendHybrasyl('stdout', 'x')
    useRuntime.getState().clearHybrasyl()
    expect(useRuntime.getState().hybrasylLog).toEqual([])
  })

  it('keeps per-instance logs separate', () => {
    useRuntime.getState().appendInstance('a', 'stdout', 'A1')
    useRuntime.getState().appendInstance('b', 'stdout', 'B1')
    useRuntime.getState().appendInstance('a', 'stderr', 'A2')
    expect(useRuntime.getState().instanceLogs.a).toEqual([
      { stream: 'stdout', text: 'A1' },
      { stream: 'stderr', text: 'A2' }
    ])
    expect(useRuntime.getState().instanceLogs.b).toEqual([{ stream: 'stdout', text: 'B1' }])
  })

  it('caps each instance buffer independently', () => {
    for (let i = 0; i < LOG_CAP + 3; i++) {
      useRuntime.getState().appendInstance('a', 'stdout', `l${i}`)
    }
    expect(useRuntime.getState().instanceLogs.a.length).toBe(LOG_CAP)
  })

  it('clears one instance without touching the others', () => {
    useRuntime.getState().appendInstance('a', 'stdout', 'A')
    useRuntime.getState().appendInstance('b', 'stdout', 'B')
    useRuntime.getState().clearInstance('a')
    expect(useRuntime.getState().instanceLogs.a).toEqual([])
    expect(useRuntime.getState().instanceLogs.b).toEqual([{ stream: 'stdout', text: 'B' }])
  })
})
