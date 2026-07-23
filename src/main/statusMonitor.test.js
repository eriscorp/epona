import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createStatusMonitor } from './statusMonitor.js'

function setup({ instances = [], tracked = new Map(), alive = new Map(), inUse = new Map() } = {}) {
  const onStatus = vi.fn()
  const onReap = vi.fn(async () => {})
  const monitor = createStatusMonitor({
    settingsManager: { load: async () => ({ instances }) },
    instanceChildren: tracked,
    isPortInUse: async (_host, port) => inUse.get(port) === true,
    isProcessAlive: (pid) => alive.get(pid) === true,
    onStatus,
    onReap,
    intervalMs: 1000
  })
  return { monitor, onStatus, onReap, tracked }
}

const pidEntry = (pid, cleanup = vi.fn(async () => {})) => ({ kind: 'pid', value: pid, cleanup })

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createStatusMonitor', () => {
  it('pushes the first snapshot, then stays quiet while nothing changes', async () => {
    const { monitor, onStatus } = setup({ instances: [{ id: 'a', lobbyPort: 2610 }] })
    await monitor.refresh()
    expect(onStatus).toHaveBeenCalledTimes(1)
    await monitor.refresh()
    expect(onStatus).toHaveBeenCalledTimes(1)
  })

  it('pushes again once a port starts listening', async () => {
    const inUse = new Map()
    const { monitor, onStatus } = setup({ instances: [{ id: 'a', lobbyPort: 2610 }], inUse })
    await monitor.refresh()
    inUse.set(2610, true)
    await monitor.refresh()
    expect(onStatus).toHaveBeenCalledTimes(2)
    expect(onStatus.mock.calls[1][0][0]).toMatchObject({ running: true, source: 'adopted' })
  })

  it('reaps a dead wrapper: untracks it, notifies, and runs its cleanup', async () => {
    // This is the leak the bug report exposed — closing the server's console
    // window left the worktree checked out because cleanup never ran.
    const cleanup = vi.fn(async () => {})
    const tracked = new Map([['a', pidEntry(4242, cleanup)]])
    const { monitor, onReap } = setup({
      instances: [{ id: 'a', lobbyPort: 2610 }],
      tracked,
      alive: new Map([[4242, false]])
    })
    await monitor.refresh()
    expect(tracked.has('a')).toBe(false)
    expect(onReap).toHaveBeenCalledOnce()
    expect(onReap.mock.calls[0][0]).toBe('a')
    // The handler owns the cleanup call; the monitor hands it the entry.
    expect(onReap.mock.calls[0][1].cleanup).toBe(cleanup)
  })

  it('keeps a live wrapper tracked', async () => {
    const tracked = new Map([['a', pidEntry(4242)]])
    const { monitor, onReap } = setup({
      instances: [{ id: 'a', lobbyPort: 2610 }],
      tracked,
      alive: new Map([[4242, true]])
    })
    const snap = await monitor.refresh()
    expect(tracked.has('a')).toBe(true)
    expect(onReap).not.toHaveBeenCalled()
    expect(snap[0]).toMatchObject({ running: true, source: 'tracked', pid: 4242 })
  })

  it("survives a reap handler that throws (it doesn't abort the pass)", async () => {
    const tracked = new Map([['a', pidEntry(1)]])
    const monitor = createStatusMonitor({
      settingsManager: { load: async () => ({ instances: [{ id: 'a', lobbyPort: 2610 }] }) },
      instanceChildren: tracked,
      isPortInUse: async () => false,
      isProcessAlive: () => false,
      onStatus: vi.fn(),
      onReap: async () => {
        throw new Error('cleanup exploded')
      }
    })
    const snap = await monitor.refresh()
    expect(snap[0]).toMatchObject({ running: false })
  })

  it('probes each distinct port once, however many instances share it', async () => {
    const probe = vi.fn(async () => false)
    const monitor = createStatusMonitor({
      settingsManager: {
        load: async () => ({
          instances: [
            { id: 'a', lobbyPort: 2610 },
            { id: 'b', lobbyPort: 2610 },
            { id: 'c', lobbyPort: 2620 }
          ]
        })
      },
      instanceChildren: new Map(),
      isPortInUse: probe,
      isProcessAlive: () => false,
      onStatus: vi.fn()
    })
    await monitor.refresh()
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('treats a failing probe as "not listening" instead of failing the pass', async () => {
    const monitor = createStatusMonitor({
      settingsManager: { load: async () => ({ instances: [{ id: 'a', lobbyPort: 2610 }] }) },
      instanceChildren: new Map(),
      isPortInUse: async () => {
        throw new Error('probe blew up')
      },
      isProcessAlive: () => false,
      onStatus: vi.fn()
    })
    expect((await monitor.refresh())[0]).toMatchObject({ running: false })
  })

  it('keeps the last snapshot when a settings load fails', async () => {
    let fail = false
    const monitor = createStatusMonitor({
      settingsManager: {
        load: async () => {
          if (fail) throw new Error('disk gone')
          return { instances: [{ id: 'a', lobbyPort: 2610 }] }
        }
      },
      instanceChildren: new Map(),
      isPortInUse: async () => true,
      isProcessAlive: () => false,
      onStatus: vi.fn()
    })
    await monitor.refresh()
    fail = true
    expect(await monitor.refresh()).toEqual(monitor.current())
    expect(monitor.current()[0]).toMatchObject({ running: true })
  })

  it('start() polls on the interval and stop() ends it', async () => {
    const { monitor, onStatus } = setup({ instances: [{ id: 'a', lobbyPort: 2610 }] })
    monitor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(onStatus).toHaveBeenCalledTimes(1) // immediate first pass

    await vi.advanceTimersByTimeAsync(3000)
    monitor.stop()
    const callsAtStop = onStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(onStatus.mock.calls.length).toBe(callsAtStop)
  })

  it('start() twice keeps a single timer', async () => {
    const { monitor } = setup()
    monitor.start()
    monitor.start()
    monitor.stop()
    // A second interval would keep firing after one stop(); reaching here with
    // no pending timers proves there was only ever one.
    expect(vi.getTimerCount()).toBe(0)
  })
})
