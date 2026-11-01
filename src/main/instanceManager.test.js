import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'
import {
  toSafeResult,
  isTrackedAlive,
  stopChild,
  resolveInstanceForLaunch,
  runOnce,
  createInstanceManager
} from './instanceManager.js'

// stopChild ends a child through killProcessTree; processKill.test.js runs that
// against real processes.
const { killProcessTree } = vi.hoisted(() => ({ killProcessTree: vi.fn() }))
vi.mock('./processKill.js', () => ({ killProcessTree }))

// A minimal stand-in for a Node ChildProcess: EventEmitter + kill().
function fakeChild() {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => {}
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

describe('stopChild', () => {
  beforeEach(() => {
    killProcessTree.mockReset()
  })

  // A child whose tree killProcessTree ends: it exits by SIGTERM, as Node reports.
  function childEndedByKill(pid = 5150) {
    const child = fakeChild()
    child.pid = pid
    killProcessTree.mockImplementation(async () => {
      setImmediate(() => {
        child.exitCode = null
        child.signalCode = 'SIGTERM'
        child.emit('exit', null, 'SIGTERM')
      })
      return { ok: true }
    })
    return child
  }

  it("ends the child's tree, not the child alone (HTOO-592)", async () => {
    const child = childEndedByKill()
    const kill = vi.spyOn(child, 'kill')

    await expect(stopChild(child)).resolves.toEqual({ ok: true })

    expect(killProcessTree).toHaveBeenCalledWith(5150, undefined)
    expect(kill).not.toHaveBeenCalled()
  })

  it("returns after the child's exit, so the exit handler has untracked it", async () => {
    const child = childEndedByKill()
    const exited = vi.fn()
    child.on('exit', exited)

    await stopChild(child, { graceMs: 100 })

    expect(exited).toHaveBeenCalled()
    expect(killProcessTree).toHaveBeenCalledWith(5150, { graceMs: 100 })
  })

  it('reports a tree that is still running, and does not wait for the exit', async () => {
    const child = fakeChild()
    child.pid = 5150
    const error = new Error('process 5150 is still running after SIGKILL')
    killProcessTree.mockResolvedValue({ ok: false, error })

    await expect(stopChild(child)).resolves.toEqual({ ok: false, error })
  })

  it('does nothing for a child that has exited or never started', async () => {
    const exited = Object.assign(fakeChild(), { pid: 1, exitCode: 0 })
    const signalled = Object.assign(fakeChild(), { pid: 2, signalCode: 'SIGKILL' })
    const neverStarted = fakeChild() // a failed spawn has no pid

    for (const child of [exited, signalled, neverStarted]) {
      await expect(stopChild(child)).resolves.toEqual({ ok: true })
    }
    expect(killProcessTree).not.toHaveBeenCalled()
  })
})

describe('runOnce', () => {
  it('runs the function on the first call only, and every call gets the same promise', async () => {
    let release
    const fn = vi.fn(() => new Promise((r) => (release = r)))
    const once = runOnce(fn)
    const first = once()
    const second = once()
    expect(second).toBe(first)
    await Promise.resolve() // the call is deferred one microtask
    expect(fn).toHaveBeenCalledTimes(1)
    release('done')
    await expect(first).resolves.toBe('done')
    await expect(once()).resolves.toBe('done')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('gives every caller the same rejection, and does not run again', async () => {
    const fn = vi.fn(async () => {
      throw new Error('worktree busy')
    })
    const once = runOnce(fn)
    await expect(once()).rejects.toThrow('worktree busy')
    await expect(once()).rejects.toThrow('worktree busy')
    expect(fn).toHaveBeenCalledTimes(1)
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
    const stopLog = vi.fn()
    const tailInstanceLog = vi.fn(() => stopLog)
    const launchServer = vi.fn().mockResolvedValue(result)
    const { spawnAndTrackInstance } = createInstanceManager({
      settingsManager: { load: vi.fn() },
      instanceChildren,
      wireInstanceLogs,
      tailInstanceLog,
      launchServer
    })
    return { spawnAndTrackInstance, instanceChildren, wireInstanceLogs, tailInstanceLog, stopLog }
  }

  it('tracks a child launch and wires its logs, returning an IPC-safe result', async () => {
    const child = fakeChild()
    const cleanup = vi.fn(async () => {})
    const { spawnAndTrackInstance, instanceChildren, wireInstanceLogs } = setup({
      success: true,
      child,
      cleanup
    })
    const safe = await spawnAndTrackInstance({ id: 'i1' })
    const entry = instanceChildren.get('i1')
    expect(entry).toMatchObject({ kind: 'child', value: child })
    // The tracked cleanup is the launch's, made run-once (HTOO-641).
    await Promise.all([entry.cleanup(), entry.cleanup()])
    expect(cleanup).toHaveBeenCalledTimes(1)
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

  it("follows a Windows server's console log into the pane (HTOO-652)", async () => {
    const { spawnAndTrackInstance, instanceChildren, tailInstanceLog, stopLog } = setup({
      success: true,
      pid: 4321,
      logFile: 'D:/logs/epona-console-i2.log'
    })
    await spawnAndTrackInstance({ id: 'i2' })
    expect(tailInstanceLog).toHaveBeenCalledWith('i2', 'D:/logs/epona-console-i2.log')
    expect(instanceChildren.get('i2').stopLog).toBe(stopLog)
  })

  it('does not track a failed launch', async () => {
    const { spawnAndTrackInstance, instanceChildren } = setup({ success: false, error: 'boom' })
    const safe = await spawnAndTrackInstance({ id: 'i3' })
    expect(instanceChildren.has('i3')).toBe(false)
    expect(safe).toEqual({ success: false, error: 'boom' })
  })
})
