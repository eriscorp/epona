import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { rmSync, mkdtempSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The main process, booted as if on macOS.
//
// process.platform is set to 'darwin' before index.js is imported, because
// index.js reads it at module load and again in whenReady. The electron double
// does not care which platform it runs on, so this runs on the Windows dev box
// and on the POSIX CI job alike.
//
// Its own file because index.js boots once per file, and the platform has to be
// set before that boot. The cases run in order against one booted process.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-darwin-boot-'))

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

const setup = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp, mkdirSync, writeFileSync } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  const { vi: vitest } = await import('vitest')
  const pathsBase = mkdtemp(joinPath(tmp(), 'epona-darwin-paths-'))
  // A settings file where the roaming migration looks for one. On macOS that
  // migration must not run: with LOCALAPPDATA redirected (the e2e helper) it
  // would copy the user's real settings into the test's temp dir.
  const roaming = joinPath(pathsBase, 'appData', 'Erisco', 'Epona')
  mkdirSync(roaming, { recursive: true })
  writeFileSync(joinPath(roaming, 'settings.json'), '{"theme":"roaming"}')
  const realPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  return {
    harness: createElectronDouble({ pathsBase }),
    realPlatform,
    killProcessTree: vitest.fn(async () => ({ ok: true })),
    launchServer: vitest.fn(),
    cleanup: vitest.fn(async () => {})
  }
})

const { harness, killProcessTree, launchServer, cleanup } = setup
const { dialog, screen } = harness.electron

vi.mock('electron', () => harness.electron)
vi.mock('./processKill.js', () => ({ killProcessTree }))
vi.mock('./targets/serverTarget.js', () => ({ launch: launchServer }))
vi.mock('./portProbe.js', () => ({ isPortInUse: async () => false }))
vi.mock('./portOwner.js', () => ({ findPortOwner: async () => null }))
vi.mock('./processAlive.js', () => ({ isProcessAlive: () => true }))
// A stub, not the real manager: the cases need a repo-mode instance that is
// resolvable by id. The roaming migration is index.js's own code and still runs.
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

const DISPLAY_EVENTS = ['display-metrics-changed', 'display-added', 'display-removed']

// The display listeners still registered: every screen.on less every removal.
function liveDisplayListeners() {
  const live = []
  for (const [event, fn] of screen.on.mock.calls) {
    if (DISPLAY_EVENTS.includes(event)) live.push([event, fn])
  }
  for (const [event, fn] of screen.removeListener.mock.calls) {
    const i = live.findIndex(([e, f]) => e === event && f === fn)
    if (i !== -1) live.splice(i, 1)
  }
  return live.map(([event]) => event).sort()
}

async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
}

beforeAll(async () => {
  process.env.LOCALAPPDATA = sandbox
  await import('./index.js')
  await harness.ready()
})

beforeEach(() => {
  dialog.showMessageBox.mockClear()
  killProcessTree.mockClear()
  harness.app.quit.mockClear()
})

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: setup.realPlatform, configurable: true })
  rmSync(sandbox, { recursive: true, force: true })
})

describe('booting on macOS', () => {
  it('puts userData under LOCALAPPDATA when it is set', () => {
    const call = harness.app.setPath.mock.calls.find(([key]) => key === 'userData')
    expect(call[1]).toBe(join(sandbox, 'Erisco', 'Epona'))
  })

  it('does not run the roaming settings migration', () => {
    // HTOO-543. Roaming is a Windows concept. Off Windows, a redirected
    // LOCALAPPDATA makes the roaming dir differ from the settings dir, and the
    // migration copied the real settings into the e2e temp dir.
    expect(existsSync(join(sandbox, 'Erisco', 'Epona', 'settings.json'))).toBe(false)
  })
})

describe('⌘W and the Dock on macOS, with a repo-mode server running', () => {
  it('closes the window on ⌘W without the quit question', async () => {
    // On macOS closing the window does not quit (window-all-closed), so the
    // server keeps running and "Quitting will stop them" would be untrue.
    launchServer.mockResolvedValue({ success: true, pid: 4444, cleanup })
    const started = await harness.invoke('instance:start', { id: INSTANCE.id })
    expect(started.success).toBe(true)
    const main = harness.windows.at(-1)

    main.close()

    expect(main.destroyed).toBe(true)
    await settle()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(killProcessTree).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
  })

  it('drops the display listeners with the closed window', () => {
    expect(liveDisplayListeners()).toEqual([])
  })

  it('asks app-modal on a Dock Quit with no window, and a Cancel stops nothing', async () => {
    expect(harness.electron.BrowserWindow.getAllWindows()).toEqual([])
    dialog.showMessageBox.mockResolvedValueOnce({ response: 0 })
    const event = { preventDefault: vi.fn() }

    harness.emitAppEvent('before-quit', event)

    expect(event.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledTimes(1))
    // No window to hang a sheet on, so the options come first.
    const [first] = dialog.showMessageBox.mock.calls[0]
    expect(first.message).toBe('Repo-mode launches are still running.')
    await settle()
    expect(killProcessTree).not.toHaveBeenCalled()
    expect(harness.app.quit).not.toHaveBeenCalled()
  })

  it('registers the display listeners again for a window the Dock re-creates', () => {
    // Without this a re-created window loses the RDP / DPI resize replay.
    harness.emitAppEvent('activate')
    expect(harness.windows.at(-1).destroyed).toBe(false)
    expect(liveDisplayListeners()).toEqual([...DISPLAY_EVENTS].sort())
  })

  it('stops the server on a confirmed Dock Quit, after the question', async () => {
    dialog.showMessageBox.mockResolvedValueOnce({ response: 1 })

    harness.emitAppEvent('before-quit', { preventDefault: vi.fn() })

    await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledTimes(1))
    expect(killProcessTree).toHaveBeenCalledWith(4444)
    expect(dialog.showMessageBox.mock.invocationCallOrder[0]).toBeLessThan(
      killProcessTree.mock.invocationCallOrder[0]
    )
  })
})
