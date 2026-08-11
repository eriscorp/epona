import { describe, it, expect } from 'vitest'
import {
  buildStatusSnapshot,
  findAmbiguousPorts,
  findDeadTracked,
  portsToProbe,
  statusChanged
} from './instanceStatus.js'

const inst = (id, lobbyPort) => ({ id, lobbyPort })
const pidEntry = (pid) => ({ kind: 'pid', value: pid, cleanup: async () => {} })
const childEntry = (pid, exitCode = null) => ({
  kind: 'child',
  value: { pid, exitCode },
  cleanup: async () => {}
})

describe('findAmbiguousPorts', () => {
  it('flags a port two instances both claim', () => {
    const ports = findAmbiguousPorts([inst('a', 2610), inst('b', 2610), inst('c', 2620)])
    expect([...ports]).toEqual([2610])
  })
  it('ignores missing/invalid ports', () => {
    expect([...findAmbiguousPorts([inst('a'), inst('b', 0), inst('c', 2610)])]).toEqual([])
    expect([...findAmbiguousPorts(undefined)]).toEqual([])
  })
})

describe('portsToProbe', () => {
  // Every probe Hybrasyl accepts costs it four log lines, one at error level.
  // For an instance Epona started and still tracks, the result is thrown away.
  it('does not probe a port a live tracked instance answers for', () => {
    expect(
      portsToProbe({
        instances: [inst('a', 2610)],
        tracked: new Map([['a', pidEntry(4242)]]),
        aliveByPid: new Map([[4242, true]])
      })
    ).toEqual([])
  })

  it('probes an untracked instance — the adoption path must keep working', () => {
    // The only way Epona sees a server it did not start, or one that outlived an
    // earlier run. Breaking this is the expensive way to get this card wrong.
    expect(
      portsToProbe({ instances: [inst('a', 2610)], tracked: new Map(), aliveByPid: new Map() })
    ).toEqual([2610])
  })

  it('probes a tracked instance whose process is dead, on the same pass', () => {
    // The monitor reaps the entry on this tick, so the fall-back probe has to
    // run in this pass or the row reports "not running" an interval late after a
    // stop Epona did not perform.
    expect(
      portsToProbe({
        instances: [inst('a', 2610)],
        tracked: new Map([['a', pidEntry(4242)]]),
        aliveByPid: new Map([[4242, false]])
      })
    ).toEqual([2610])
  })

  it('reads a child entry from its exitCode, exactly as the snapshot does', () => {
    const instances = [inst('a', 2610)]
    expect(
      portsToProbe({ instances, tracked: new Map([['a', childEntry(99)]]), aliveByPid: new Map() })
    ).toEqual([])
    expect(
      portsToProbe({
        instances,
        tracked: new Map([['a', childEntry(99, 0)]]),
        aliveByPid: new Map()
      })
    ).toEqual([2610])
  })

  it('skips an ambiguous port entirely — the snapshot discards its answer', () => {
    expect(
      portsToProbe({
        instances: [inst('a', 2610), inst('b', 2610)],
        tracked: new Map(),
        aliveByPid: new Map()
      })
    ).toEqual([])
  })

  it('still probes once for two untracked instances on distinct ports', () => {
    expect(
      portsToProbe({
        instances: [inst('a', 2610), inst('b', 2620), inst('c', 2620)],
        tracked: new Map(),
        aliveByPid: new Map()
      })
      // 2620 is ambiguous (b and c both claim it), so only 2610 survives.
    ).toEqual([2610])
  })

  it('ignores instances with no port, and copes with empty settings', () => {
    expect(portsToProbe({ instances: [inst('a'), inst('b', 0)], tracked: new Map() })).toEqual([])
    expect(portsToProbe({ instances: undefined, tracked: undefined })).toEqual([])
  })

  it('agrees with buildStatusSnapshot about which rows the probe decides', () => {
    // The rule lives in one place precisely so these cannot drift: any instance
    // the snapshot resolves WITHOUT the probe must not be probed, and any
    // instance it resolves WITH the probe must be.
    const instances = [inst('live', 2610), inst('dead', 2620), inst('adopt', 2630)]
    const tracked = new Map([
      ['live', pidEntry(1)],
      ['dead', childEntry(2, 0)]
    ])
    const aliveByPid = new Map([[1, true]])
    const probed = new Set(portsToProbe({ instances, tracked, aliveByPid }))
    const snap = buildStatusSnapshot({ instances, tracked, aliveByPid, portsInUse: new Map() })
    for (const [i, row] of snap.entries()) {
      // source 'tracked' means the entry answered; anything else needed the probe.
      expect(probed.has(instances[i].lobbyPort)).toBe(row.source !== 'tracked')
    }
  })
})

describe('buildStatusSnapshot', () => {
  it('reports a tracked, live pid instance as running', () => {
    const snap = buildStatusSnapshot({
      instances: [inst('a', 2610)],
      tracked: new Map([['a', pidEntry(4242)]]),
      aliveByPid: new Map([[4242, true]]),
      portsInUse: new Map()
    })
    expect(snap).toEqual([
      { id: 'a', running: true, pid: 4242, source: 'tracked', ambiguousPort: false }
    ])
  })

  it('falls back to the port probe when the tracked wrapper died', () => {
    // The exact reported bug's mirror: the console window is gone, so the pid is
    // dead — the row must not stay "running" just because we still track it.
    const snap = buildStatusSnapshot({
      instances: [inst('a', 2610)],
      tracked: new Map([['a', pidEntry(4242)]]),
      aliveByPid: new Map([[4242, false]]),
      portsInUse: new Map([[2610, false]])
    })
    expect(snap[0]).toMatchObject({ running: false, source: null })
  })

  it('adopts an untracked instance whose lobby port is listening', () => {
    // A server that outlived a previous Epona run — the case where the UI used
    // to offer "Start Server" for something already running.
    const snap = buildStatusSnapshot({
      instances: [inst('a', 2610)],
      tracked: new Map(),
      aliveByPid: new Map(),
      portsInUse: new Map([[2610, true]])
    })
    expect(snap[0]).toEqual({
      id: 'a',
      running: true,
      pid: null,
      source: 'adopted',
      ambiguousPort: false
    })
  })

  it("won't adopt when two instances share a lobby port", () => {
    // The probe can't say which of them owns the listener, so neither is claimed.
    const snap = buildStatusSnapshot({
      instances: [inst('a', 2610), inst('b', 2610)],
      tracked: new Map(),
      aliveByPid: new Map(),
      portsInUse: new Map([[2610, true]])
    })
    expect(snap.map((s) => s.running)).toEqual([false, false])
    expect(snap.every((s) => s.ambiguousPort)).toBe(true)
  })

  it('still reports a tracked instance on a shared port', () => {
    // Ambiguity only blocks adoption — we know who we started.
    const snap = buildStatusSnapshot({
      instances: [inst('a', 2610), inst('b', 2610)],
      tracked: new Map([['a', pidEntry(7)]]),
      aliveByPid: new Map([[7, true]]),
      portsInUse: new Map([[2610, true]])
    })
    expect(snap[0]).toMatchObject({ running: true, source: 'tracked' })
    expect(snap[1]).toMatchObject({ running: false, ambiguousPort: true })
  })

  it('reads child entries from their exitCode, not the pid map', () => {
    const alive = buildStatusSnapshot({
      instances: [inst('a', 2610)],
      tracked: new Map([['a', childEntry(99)]]),
      aliveByPid: new Map(),
      portsInUse: new Map()
    })
    expect(alive[0]).toMatchObject({ running: true, pid: 99, source: 'tracked' })

    const exited = buildStatusSnapshot({
      instances: [inst('a', 2610)],
      tracked: new Map([['a', childEntry(99, 0)]]),
      aliveByPid: new Map(),
      portsInUse: new Map([[2610, false]])
    })
    expect(exited[0]).toMatchObject({ running: false, source: null })
  })

  it('returns a row per instance and copes with empty settings', () => {
    expect(
      buildStatusSnapshot({ instances: undefined, tracked: new Map(), portsInUse: new Map() })
    ).toEqual([])
  })
})

describe('findDeadTracked', () => {
  it('returns pid entries whose process is gone', () => {
    const tracked = new Map([
      ['dead', pidEntry(1)],
      ['live', pidEntry(2)],
      ['child', childEntry(3, 0)]
    ])
    const alive = new Map([
      [1, false],
      [2, true]
    ])
    // The child is excluded — its own 'exit' event already drives cleanup.
    expect(findDeadTracked(tracked, alive)).toEqual(['dead'])
  })

  it('leaves a pid we have no answer for alone', () => {
    expect(findDeadTracked(new Map([['a', pidEntry(1)]]), new Map())).toEqual([])
  })
})

describe('statusChanged', () => {
  const base = [{ id: 'a', running: true, pid: 1, source: 'tracked', ambiguousPort: false }]

  it('is true on the first snapshot', () => {
    expect(statusChanged(null, base)).toBe(true)
  })
  it('is false for an identical snapshot', () => {
    expect(statusChanged(base, structuredClone(base))).toBe(false)
  })
  it('notices a running flip, a pid change, and a source change', () => {
    expect(statusChanged(base, [{ ...base[0], running: false }])).toBe(true)
    expect(statusChanged(base, [{ ...base[0], pid: 2 }])).toBe(true)
    expect(statusChanged(base, [{ ...base[0], source: 'adopted' }])).toBe(true)
  })
  it('notices an added or removed instance', () => {
    expect(statusChanged(base, [...base, { ...base[0], id: 'b' }])).toBe(true)
    expect(statusChanged(base, [])).toBe(true)
  })
})
