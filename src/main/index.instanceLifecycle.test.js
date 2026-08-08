import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The PID-tracked instance lifecycle: instance:stop and instance:reset.
//
// This is the ground HTOO-99 exists to unblock.
// docs/plans/complete/efficiency-review-2026-07-12.md M1 wants
// the duplicated PID-kill/delete/childExit block in these two handlers extracted
// into a shared `reapPidInstance`, and the review deliberately did NOT do it:
//
//   "stop vs reset have genuinely different kill-failure semantics; a shared
//    helper in 0%-covered lifecycle code risked a regression"
//
// So these tests pin that difference rather than the parts that are the same. A
// helper that unified the kill-failure path would pass a test asserting only the
// happy path, and would break exactly one of the two cases below.
//
// The divergence, read off the handlers:
//
//   stop  — checks killProcessTree's result. On failure it returns an error and
//           leaves the instance TRACKED, un-notified and un-cleaned-up, because
//           the process is still out there.
//   reset — ignores the result entirely, deletes, notifies, cleans up and
//           relaunches regardless, because the user asked for a running server
//           and a stale wrapper is not a reason to refuse them one.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-lifecycle-'))

const WORLD_DIR = join(sandbox, 'world')
// Ports included because the status monitor polls them on a timer as soon as boot
// finishes. Left undefined, net.connect throws "options or port or path must be
// specified" from inside the poll and every test in the file fails on it.
const INSTANCE = {
  id: 'inst-1',
  name: 'Test instance',
  mode: 'binary',
  binaryPath: join(sandbox, 'server.exe'),
  worldDirectoryId: 'wd-1',
  lobbyPort: 2610,
  loginPort: 2611,
  worldPort: 2612,
  redisHost: '127.0.0.1',
  redisPort: 6379
}

const mocks = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  const { vi: vitest } = await import('vitest')
  return {
    harness: createElectronDouble({
      pathsBase: mkdtemp(joinPath(tmp(), 'epona-lifecycle-paths-'))
    }),
    killProcessTree: vitest.fn(),
    launchServer: vitest.fn(),
    cleanup: vitest.fn(),
    isPortInUse: vitest.fn(),
    findPortOwner: vitest.fn()
  }
})

const { harness, killProcessTree, launchServer, cleanup, isPortInUse, findPortOwner } = mocks

vi.mock('electron', () => harness.electron)
vi.mock('./processKill.js', () => ({ killProcessTree }))
vi.mock('./targets/serverTarget.js', () => ({ launch: launchServer }))
// Hermetic: the status monitor polls the instance's ports on a timer, and the
// adopted-instance path probes them too. Left real, these tests would open
// loopback sockets on a schedule and depend on nothing else using port 2610.
vi.mock('./portProbe.js', () => ({ isPortInUse }))
vi.mock('./portOwner.js', () => ({ findPortOwner }))

// The real settings manager reads and migrates a file; a stub keeps this test
// about the lifecycle rather than about the settings schema. Instances have to be
// resolvable BY ID from "disk" because that is the spawn-path hardening in
// resolveSuppliedInstance — the renderer's payload is not trusted for paths.
vi.mock('./settingsManager.js', () => ({
  createSettingsManager: () => ({
    load: async () => ({
      instances: [INSTANCE],
      worldDirectories: [{ id: 'wd-1', name: 'world', path: WORLD_DIR }],
      activeInstance: 'inst-1',
      profiles: [],
      targets: { hybrasyl: {} }
    }),
    save: async () => {},
    path: join(sandbox, 'settings.json')
  })
}))

const PID = 4242

async function startPidInstance() {
  launchServer.mockResolvedValue({ success: true, pid: PID, cleanup })
  const result = await harness.invoke('instance:start', { id: 'inst-1' })
  expect(result.success).toBe(true)
  return result
}

beforeAll(async () => {
  process.env.LOCALAPPDATA = sandbox
  await import('./index.js')
  await harness.ready()
})

beforeEach(async () => {
  killProcessTree.mockReset().mockResolvedValue({ ok: true })
  launchServer.mockReset().mockResolvedValue({ success: true, pid: PID, cleanup })
  cleanup.mockReset().mockResolvedValue(undefined)
  isPortInUse.mockReset().mockResolvedValue(false)
  findPortOwner.mockReset().mockResolvedValue(null)

  // `instanceChildren` is module state inside the booted index.js, and index.js
  // can only be imported once, so it persists across tests in this file. A test
  // that deliberately leaves a failed kill behind would otherwise hand the next
  // one an already-tracked instance — which is exactly the state that makes
  // instance:start and instance:reset take different branches.
  await harness.invoke('instance:stop', 'inst-1')

  // Cleared AFTER the teardown stop, so each test's assertions see only the calls
  // it caused.
  killProcessTree.mockClear()
  launchServer.mockClear()
  cleanup.mockClear()
  harness.windows.at(-1).webContents.send.mockClear()
})

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('instance:stop for a PID-tracked instance', () => {
  it('kills the wrapper, untracks it, notifies the renderer and cleans up', async () => {
    await startPidInstance()

    const result = await harness.invoke('instance:stop', 'inst-1')

    expect(result).toEqual({ success: true, wasRunning: true })
    expect(killProcessTree).toHaveBeenCalledWith(PID)
    expect(cleanup).toHaveBeenCalled()
    // The synthesized exit: a PID entry has no child stream to emit a natural
    // 'exit', so stop has to tell the renderer itself or the button never settles.
    const sends = harness.windows.at(-1).webContents.send.mock.calls
    const exit = sends.find(([channel]) => channel === 'instance:childExit')
    expect(exit).toBeTruthy()
    expect(exit[1]).toMatchObject({ instanceId: 'inst-1', pid: PID, signal: 'SIGKILL' })
  })

  it('reports a failed kill and leaves the instance tracked', async () => {
    // THE DIVERGENCE. Untracking here would tell the renderer the server stopped
    // while the wrapper is still holding its ports, and the next Start would race
    // it on the bind. So stop refuses rather than lying.
    await startPidInstance()
    killProcessTree.mockResolvedValue({ ok: false, error: new Error('access denied') })

    const result = await harness.invoke('instance:stop', 'inst-1')

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/kill failed: access denied/)
    expect(cleanup).not.toHaveBeenCalled()
    const sends = harness.windows.at(-1).webContents.send.mock.calls
    expect(sends.find(([channel]) => channel === 'instance:childExit')).toBeUndefined()
  })

  it('is still tracked after a failed kill, so a second stop retries it', async () => {
    // The observable consequence of staying tracked: stop takes the tracked path
    // again rather than falling through to the adopted-instance branch.
    await startPidInstance()
    killProcessTree.mockResolvedValue({ ok: false, error: new Error('denied') })
    await harness.invoke('instance:stop', 'inst-1')

    killProcessTree.mockResolvedValue({ ok: true })
    const second = await harness.invoke('instance:stop', 'inst-1')

    expect(second).toEqual({ success: true, wasRunning: true })
    expect(killProcessTree).toHaveBeenCalledTimes(2)
  })
})

describe('instance:reset for a PID-tracked instance', () => {
  it('kills, cleans up and relaunches in one round trip', async () => {
    await startPidInstance()
    launchServer.mockResolvedValue({ success: true, pid: 5555, cleanup })
    const launchesBefore = launchServer.mock.calls.length

    const result = await harness.invoke('instance:reset', { id: 'inst-1' })

    expect(result.success).toBe(true)
    expect(killProcessTree).toHaveBeenCalledWith(PID)
    expect(cleanup).toHaveBeenCalled()
    // Counted as a delta, not an absolute: starting the instance is itself a
    // launch, so an absolute count silently asserts the wrong thing.
    expect(launchServer.mock.calls.length).toBe(launchesBefore + 1)
  })

  it('relaunches even when the kill failed', async () => {
    // THE OTHER SIDE OF THE DIVERGENCE, and the one a shared helper would break.
    // Reset does not check killProcessTree's result. That is deliberate: the user
    // asked for a running server, and refusing to start one because a stale
    // wrapper would not die leaves them with nothing.
    await startPidInstance()
    killProcessTree.mockResolvedValue({ ok: false, error: new Error('access denied') })
    launchServer.mockResolvedValue({ success: true, pid: 6666, cleanup })
    const launchesBefore = launchServer.mock.calls.length

    const result = await harness.invoke('instance:reset', { id: 'inst-1' })

    expect(result.success).toBe(true)
    expect(launchServer.mock.calls.length).toBe(launchesBefore + 1)
    expect(cleanup).toHaveBeenCalled()
  })

  it('refuses to reset an instance that is not running', async () => {
    await expect(harness.invoke('instance:reset', { id: 'inst-1' })).resolves.toEqual({
      success: false,
      error: 'instance is not running'
    })
  })

  it('refuses a payload the renderer should not be able to send', async () => {
    // Spawn-path hardening: paths come from saved settings by id, never from the
    // renderer's copy of the instance.
    await expect(harness.invoke('instance:reset', { id: 'not-saved' })).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('not in saved settings')
    })
    await expect(harness.invoke('instance:reset', {})).resolves.toEqual({
      success: false,
      error: 'invalid instance payload'
    })
  })

  it('survives a cleanup that throws, and still relaunches', async () => {
    // cleanup releases the git worktree. A failure there is logged, not fatal —
    // the alternative is an instance that can never be restarted.
    await startPidInstance()
    cleanup.mockRejectedValue(new Error('worktree busy'))
    launchServer.mockResolvedValue({ success: true, pid: 7777, cleanup })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const result = await harness.invoke('instance:reset', { id: 'inst-1' })
      expect(result.success).toBe(true)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('instance:stop for an instance Epona never launched', () => {
  // The status monitor adopts a server it finds listening on the lobby port, so
  // stop has to handle an instance with no child and no wrapper pid.
  it('says nothing was running for an id that is not in settings', async () => {
    await expect(harness.invoke('instance:stop', 'never-started')).resolves.toEqual({
      success: true,
      wasRunning: false
    })
  })

  it('says nothing was running when the lobby port is free', async () => {
    isPortInUse.mockResolvedValue(false)
    await expect(harness.invoke('instance:stop', 'inst-1')).resolves.toEqual({
      success: true,
      wasRunning: false
    })
  })

  it('kills the adopted process that owns the port', async () => {
    isPortInUse.mockResolvedValue(true)
    findPortOwner.mockResolvedValue(9191)

    const result = await harness.invoke('instance:stop', 'inst-1')

    expect(result).toMatchObject({ success: true, wasRunning: true, adopted: true, pid: 9191 })
    expect(killProcessTree).toHaveBeenCalledWith(9191)
  })

  it('tells the user to use Task Manager when it cannot find the owner', async () => {
    // The one case with no action available. Reporting success would leave the
    // renderer showing a stopped server that is still holding the port.
    isPortInUse.mockResolvedValue(true)
    findPortOwner.mockResolvedValue(null)

    const result = await harness.invoke('instance:stop', 'inst-1')

    expect(result.success).toBe(false)
    expect(result.adopted).toBe(true)
    expect(result.error).toMatch(/2610/)
    expect(result.error).toMatch(/Task Manager/)
  })
})
