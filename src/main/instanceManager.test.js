import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import {
  toSafeResult,
  isTrackedAlive,
  raceChildExit,
  resolveInstanceForLaunch,
  createInstanceManager
} from './instanceManager.js'

// A minimal stand-in for a Node ChildProcess: EventEmitter + kill(). Configure
// how kill() behaves per test (emit exit, do nothing, or throw).
function fakeChild(onKill) {
  const child = new EventEmitter()
  child.exitCode = null
  child.kill = onKill || (() => {})
  return child
}

describe('toSafeResult', () => {
  it('strips child and cleanup, keeps everything else', () => {
    const child = fakeChild()
    const cleanup = async () => {}
    expect(toSafeResult({ success: true, pid: 7, child, cleanup })).toEqual({
      success: true,
      pid: 7
    })
  })
})

describe('isTrackedAlive', () => {
  it('child is alive while exitCode is null', () => {
    expect(isTrackedAlive({ kind: 'child', value: { exitCode: null } })).toBe(true)
  })
  it('child is dead once exitCode is set', () => {
    expect(isTrackedAlive({ kind: 'child', value: { exitCode: 0 } })).toBe(false)
  })
  it('pid entries are always considered alive', () => {
    expect(isTrackedAlive({ kind: 'pid', value: 1234 })).toBe(true)
  })
})

describe('raceChildExit', () => {
  it('resolves when the child exits after kill', async () => {
    const child = fakeChild(function () {
      setImmediate(() => this.emit('exit', 0, null))
    })
    const killSpy = vi.spyOn(child, 'kill')
    await raceChildExit(child, 1000)
    expect(killSpy).toHaveBeenCalled()
  })

  it('resolves via the timeout when the child never exits', async () => {
    const child = fakeChild(() => {}) // kill is a no-op; no exit ever fires
    const start = Date.now()
    await raceChildExit(child, 20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })

  it('swallows a throwing kill and still resolves via timeout', async () => {
    const child = fakeChild(() => {
      throw new Error('already gone')
    })
    await expect(raceChildExit(child, 20)).resolves.toBeUndefined()
  })
})

describe('resolveInstanceForLaunch', () => {
  const settings = { worldDirectories: [{ id: 'wd1', path: 'D:/worlds/ceridwen' }] }

  it('attaches the resolved dataDir', () => {
    const instance = { id: 'i1', worldDirectoryId: 'wd1' }
    expect(resolveInstanceForLaunch(settings, instance)).toEqual({
      id: 'i1',
      worldDirectoryId: 'wd1',
      dataDir: 'D:/worlds/ceridwen'
    })
  })

  it('returns null when the world directory is missing', () => {
    expect(resolveInstanceForLaunch(settings, { id: 'i1', worldDirectoryId: 'gone' })).toBeNull()
  })
})

describe('createInstanceManager.resolveSuppliedInstance', () => {
  function mgrWith(settings) {
    const settingsManager = { load: vi.fn().mockResolvedValue(settings) }
    return createInstanceManager({
      settingsManager,
      instanceChildren: new Map(),
      wireInstanceLogs: vi.fn(),
      launchServer: vi.fn()
    })
  }

  it('rejects an invalid payload', async () => {
    const { resolveSuppliedInstance } = mgrWith({ instances: [], worldDirectories: [] })
    expect(await resolveSuppliedInstance(null)).toEqual({ error: 'invalid instance payload' })
    expect(await resolveSuppliedInstance({ id: 123 })).toEqual({
      error: 'invalid instance payload'
    })
  })

  it('rejects an id not in saved settings', async () => {
    const { resolveSuppliedInstance } = mgrWith({ instances: [], worldDirectories: [] })
    expect(await resolveSuppliedInstance({ id: 'nope' })).toEqual({
      error: 'instance not in saved settings — save changes first'
    })
  })

  it('rejects when the instance has no resolvable world directory', async () => {
    const { resolveSuppliedInstance } = mgrWith({
      instances: [{ id: 'i1', worldDirectoryId: 'gone' }],
      worldDirectories: []
    })
    expect(await resolveSuppliedInstance({ id: 'i1' })).toEqual({
      error: 'World directory not selected for this instance — pick one in settings.'
    })
  })

  it('resolves the disk-persisted instance with its dataDir', async () => {
    const { resolveSuppliedInstance } = mgrWith({
      instances: [{ id: 'i1', worldDirectoryId: 'wd1', name: 'QA' }],
      worldDirectories: [{ id: 'wd1', path: 'D:/worlds/qa' }]
    })
    // A forged path in the supplied payload must be ignored (disk wins).
    const result = await resolveSuppliedInstance({ id: 'i1', dataDir: '/evil' })
    expect(result).toEqual({
      instance: { id: 'i1', worldDirectoryId: 'wd1', name: 'QA', dataDir: 'D:/worlds/qa' }
    })
  })
})

describe('createInstanceManager.spawnAndTrackInstance', () => {
  function setup(result) {
    const instanceChildren = new Map()
    const wireInstanceLogs = vi.fn()
    const launchServer = vi.fn().mockResolvedValue(result)
    const { spawnAndTrackInstance } = createInstanceManager({
      settingsManager: { load: vi.fn() },
      instanceChildren,
      wireInstanceLogs,
      launchServer
    })
    return { spawnAndTrackInstance, instanceChildren, wireInstanceLogs }
  }

  it('tracks a child launch and wires its logs, returning an IPC-safe result', async () => {
    const child = fakeChild()
    const cleanup = async () => {}
    const { spawnAndTrackInstance, instanceChildren, wireInstanceLogs } = setup({
      success: true,
      child,
      cleanup
    })
    const safe = await spawnAndTrackInstance({ id: 'i1' })
    expect(instanceChildren.get('i1')).toEqual({ kind: 'child', value: child, cleanup })
    expect(wireInstanceLogs).toHaveBeenCalledWith('i1', child)
    expect(safe).toEqual({ success: true })
  })

  it('tracks a pid launch without wiring logs', async () => {
    const { spawnAndTrackInstance, instanceChildren, wireInstanceLogs } = setup({
      success: true,
      pid: 4321
    })
    const safe = await spawnAndTrackInstance({ id: 'i2' })
    expect(instanceChildren.get('i2')).toMatchObject({ kind: 'pid', value: 4321 })
    expect(wireInstanceLogs).not.toHaveBeenCalled()
    expect(safe).toEqual({ success: true, pid: 4321 })
  })

  it('does not track a failed launch', async () => {
    const { spawnAndTrackInstance, instanceChildren } = setup({ success: false, error: 'boom' })
    const safe = await spawnAndTrackInstance({ id: 'i3' })
    expect(instanceChildren.has('i3')).toBe(false)
    expect(safe).toEqual({ success: false, error: 'boom' })
  })
})
