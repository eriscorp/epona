import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { EventEmitter } from 'events'
import { rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { actAsNonMac } from './electronDouble.js'

// What the quit sweep stops, and in what order (HTOO-644, HTOO-592).
//
// The quit question lists the repo-mode Hybrasyl client and says "Quitting will
// stop them and release their git worktrees". The sweep went through the
// tracked servers only, so the client ran on, and on macOS and Linux
// `git worktree remove` then deleted its worktree under it. The sweep ran no
// launch's cleanup either, so `Directory.Build.props` survived every quit. It
// also stopped the servers one at a time, 2 s each, against a server shutdown
// that takes 2 s.
//
// index.quit.test.js pins the question before the kill. This file pins the
// sweep: every launch stopped at once, each cleanup after its own kill and only
// after a kill that worked, and the worktrees released after all of them. One
// quit per boot, so one test.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-quit-sweep-'))

const server = (id, lobbyPort) => ({
  id,
  name: id,
  mode: 'repo',
  repoPath: join(sandbox, 'server'),
  worldDirectoryId: 'wd-1',
  lobbyPort,
  loginPort: lobbyPort + 1,
  worldPort: lobbyPort + 2,
  redisHost: '127.0.0.1',
  redisPort: 6379
})
const STOPS = server('stops', 2610)
const STUCK = server('stuck', 2710)

const mocks = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  const { vi: vitest } = await import('vitest')
  return {
    harness: createElectronDouble({
      pathsBase: mkdtemp(joinPath(tmp(), 'epona-quit-sweep-paths-'))
    }),
    killProcessTree: vitest.fn(),
    launchServer: vitest.fn(),
    launchHybrasyl: vitest.fn(),
    releaseAll: vitest.fn()
  }
})

const { harness, killProcessTree, launchServer, launchHybrasyl, releaseAll } = mocks
const { dialog } = harness.electron

vi.mock('electron', () => harness.electron)
vi.mock('./processKill.js', () => ({ killProcessTree }))
vi.mock('./targets/serverTarget.js', () => ({ launch: launchServer }))
vi.mock('./targets/hybrasylTarget.js', () => ({ launch: launchHybrasyl, resolvePath: vi.fn() }))
vi.mock('./portProbe.js', () => ({ isPortInUse: async () => false }))
vi.mock('./portOwner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  findPortOwner: async () => null
}))
vi.mock('./processAlive.js', () => ({ isProcessAlive: () => true }))
vi.mock('./worktreeManager.js', async (importOriginal) => ({
  ...(await importOriginal()),
  releaseAll,
  sweepOrphans: async () => ({ removed: [], errors: [] })
}))
vi.mock('./settingsManager.js', () => ({
  createSettingsManager: () => ({
    load: async () => ({
      instances: [STOPS, STUCK],
      worldDirectories: [{ id: 'wd-1', name: 'world', path: join(sandbox, 'world') }],
      activeInstance: STOPS.id,
      profiles: [],
      targets: { hybrasyl: {} }
    }),
    save: async () => {},
    path: join(sandbox, 'settings.json')
  })
}))

// The order of everything the sweep does, by name.
const events = []
const children = new Map()

// A piped child, as spawnDirect (a server) and a repo-mode client launch return
// one on macOS and Linux.
function fakeChild(pid) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = pid
  child.exitCode = null
  child.signalCode = null
  children.set(pid, child)
  return child
}

const cleanupFor = (name) => vi.fn(async () => events.push(`cleanup ${name}`))
const cleanups = {
  stops: cleanupFor('stops'),
  stuck: cleanupFor('stuck'),
  client: cleanupFor('client')
}

let restorePlatform
let warn

beforeAll(async () => {
  restorePlatform = actAsNonMac()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  process.env.LOCALAPPDATA = sandbox
  await import('./index.js')
  await harness.ready()

  launchServer.mockImplementation(async (inst) => ({
    success: true,
    child: fakeChild(inst.id === STOPS.id ? 5150 : 5250),
    cleanup: cleanups[inst.id]
  }))
  for (const inst of [STOPS, STUCK]) {
    await expect(harness.invoke('instance:start', { id: inst.id })).resolves.toMatchObject({
      success: true
    })
  }
  launchHybrasyl.mockResolvedValue({
    success: true,
    kind: 'repo',
    child: fakeChild(7070),
    cleanup: cleanups.client
  })
  await expect(harness.invoke('client:launch', 'hybrasyl', {}, null)).resolves.toMatchObject({
    success: true
  })
})

afterAll(() => {
  warn.mockRestore()
  restorePlatform()
  rmSync(sandbox, { recursive: true, force: true })
})

describe('the quit sweep', () => {
  it('stops the client and every server at once, cleans up after each kill, then releases the worktrees', async () => {
    // Each kill waits until all three have started: a sweep that stops one
    // launch at a time never gets past the first.
    let allStarted
    const gate = new Promise((resolve) => (allStarted = resolve))
    killProcessTree.mockImplementation(async (pid) => {
      events.push(`kill ${pid}`)
      if (killProcessTree.mock.calls.length === 3) allStarted()
      await gate
      if (pid === 5250) return { ok: false, error: new Error('still running') }
      const child = children.get(pid)
      child.signalCode = 'SIGTERM'
      setImmediate(() => child.emit('exit', null, 'SIGTERM'))
      return { ok: true }
    })
    releaseAll.mockImplementation(async () => events.push('release'))
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })

    harness.emitAppEvent('before-quit', { preventDefault: vi.fn() })

    await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledTimes(1))
    // The question listed the client, and the sweep stopped it.
    expect(dialog.showMessageBox.mock.calls[0][1].detail).toContain('Hybrasyl client (repo mode)')
    expect(killProcessTree.mock.calls.map(([pid]) => pid).sort()).toEqual([5150, 5250, 7070])
    const at = (event) => events.indexOf(event)
    expect(at('cleanup stops')).toBeGreaterThan(at('kill 5150'))
    expect(at('cleanup client')).toBeGreaterThan(at('kill 7070'))
    // A server that outlived its kill keeps its worktree and its build props.
    expect(cleanups.stuck).not.toHaveBeenCalled()
    expect(cleanups.stops).toHaveBeenCalledTimes(1)
    expect(cleanups.client).toHaveBeenCalledTimes(1)
    expect(at('release')).toBeGreaterThan(Math.max(at('cleanup stops'), at('cleanup client')))
  })
})
