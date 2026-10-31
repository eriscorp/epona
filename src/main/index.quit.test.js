import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { actAsNonMac } from './electronDouble.js'

// A quit while a repo-mode server runs: the question comes BEFORE the kill.
//
// before-quit used to cancel the quit, kill every tracked server, release the
// worktrees, and only then quit again. The window's close guard asked its
// "Repo-mode launches are still running" question after that, so it found
// nothing to ask about (or asked when the answer no longer mattered): ⌘Q, the
// menu's Quit and the Dock's Quit stopped the servers without a word, and a
// Cancel could not bring them back. The old test of the quit path never saw
// it, because `app._eponaCleanupRan` auto-vivified truthy in the double and
// the sweep never ran.
//
// What is pinned here is ORDER: the dialog before any kill, and nothing killed
// on Cancel.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-quit-'))

const INSTANCE = {
  id: 'inst-repo',
  name: 'Repo server',
  mode: 'repo',
  repoPath: join(sandbox, 'server'),
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
      pathsBase: mkdtemp(joinPath(tmp(), 'epona-quit-paths-'))
    }),
    killProcessTree: vitest.fn(async () => ({ ok: true })),
    launchServer: vitest.fn(),
    cleanup: vitest.fn(async () => {}),
    releaseAll: vitest.fn(async () => {})
  }
})

const { harness, killProcessTree, launchServer, cleanup, releaseAll } = mocks
const { dialog } = harness.electron

vi.mock('electron', () => harness.electron)
vi.mock('./processKill.js', () => ({ killProcessTree }))
vi.mock('./targets/serverTarget.js', () => ({ launch: launchServer }))
// Hermetic, as in index.instanceLifecycle.test.js. The status monitor must also
// see the wrapper as alive, or a poll reaps the instance mid-test.
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
      instances: [INSTANCE],
      worldDirectories: [{ id: 'wd-1', name: 'world', path: join(sandbox, 'world') }],
      activeInstance: INSTANCE.id,
      profiles: [],
      targets: { hybrasyl: {} }
    }),
    save: async () => {},
    path: join(sandbox, 'settings.json')
  })
}))

const PID = 4343

function beforeQuitEvent() {
  return { preventDefault: vi.fn() }
}

let restorePlatform

beforeAll(async () => {
  restorePlatform = actAsNonMac()
  process.env.LOCALAPPDATA = sandbox
  await import('./index.js')
  await harness.ready()
  launchServer.mockResolvedValue({ success: true, pid: PID, cleanup })
  const started = await harness.invoke('instance:start', { id: INSTANCE.id })
  expect(started.success).toBe(true)
})

// Let the pending promise chain run (the question, then the sweep).
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
}

beforeEach(() => {
  dialog.showMessageBox.mockClear()
  killProcessTree.mockClear()
  releaseAll.mockClear()
  harness.app.quit.mockClear()
})

afterAll(() => {
  restorePlatform()
  rmSync(sandbox, { recursive: true, force: true })
})

describe('a quit with a repo-mode server running', () => {
  it('asks first, and a Cancel stops nothing', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const event = beforeQuitEvent()

    harness.emitAppEvent('before-quit', event)

    // The quit is held while the question is open.
    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    const [parent, options] = dialog.showMessageBox.mock.calls[0]
    expect(parent).toBe(harness.windows.at(-1))
    expect(options.detail).toContain('Server "Repo server" (repo mode)')

    // Let the Cancel settle, then check that nothing was stopped.
    await settle()
    expect(killProcessTree).not.toHaveBeenCalled()
    expect(releaseAll).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
  })

  it('asks again on the next quit, because the server still runs', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    harness.emitAppEvent('before-quit', beforeQuitEvent())
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    await settle()
    expect(killProcessTree).not.toHaveBeenCalled()
  })

  it('asks on a window close too, and a Cancel keeps the window', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const main = harness.windows.at(-1)

    main.close()

    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    await settle()
    expect(main.destroyed).toBe(false)
    expect(killProcessTree).not.toHaveBeenCalled()
  })

  it('restores a minimized window before it asks, so the question shows', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const main = harness.windows.at(-1)
    main.isMinimized = () => true
    main.restore = vi.fn()
    try {
      harness.emitAppEvent('before-quit', beforeQuitEvent())
      await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
      expect(main.restore).toHaveBeenCalled()
      expect(main.restore.mock.invocationCallOrder[0]).toBeLessThan(
        dialog.showMessageBox.mock.invocationCallOrder[0]
      )
      await settle()
    } finally {
      delete main.isMinimized
      delete main.restore
    }
  })

  it('stops the server only after the user picks Quit, then quits once', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })

    harness.emitAppEvent('before-quit', beforeQuitEvent())

    await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledTimes(1))
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
    expect(killProcessTree).toHaveBeenCalledWith(PID)
    // THE ORDER. The question came before the kill, and the quit after both.
    const asked = dialog.showMessageBox.mock.invocationCallOrder[0]
    const killed = killProcessTree.mock.invocationCallOrder[0]
    const released = releaseAll.mock.invocationCallOrder[0]
    const quit = harness.app.quit.mock.invocationCallOrder[0]
    expect(asked).toBeLessThan(killed)
    expect(killed).toBeLessThan(released)
    expect(released).toBeLessThan(quit)
  })

  it('lets the quit that follows through, and closes the window without asking', () => {
    // Electron raises before-quit again for the app.quit() above, then closes
    // each window. Neither may hold the quit or ask a second time.
    const event = beforeQuitEvent()
    harness.emitAppEvent('before-quit', event)
    expect(event.preventDefault).not.toHaveBeenCalled()

    const main = harness.windows.at(-1)
    main.visible = true
    main.close()

    expect(main.destroyed).toBe(true)
    expect(main.visible).toBe(false)
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })
})
