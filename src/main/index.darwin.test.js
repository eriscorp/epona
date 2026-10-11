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
  const harness = createElectronDouble({ pathsBase })
  // How many windows existed at each setApplicationMenu call: the menu must be
  // in place before the first window, or that window's first frame on macOS has
  // Electron's default menu (with Reload).
  const windowsAtMenu = []
  harness.electron.Menu.setApplicationMenu.mockImplementation(() => {
    windowsAtMenu.push(harness.windows.length)
  })
  return {
    harness,
    windowsAtMenu,
    realPlatform,
    killProcessTree: vitest.fn(async () => ({ ok: true })),
    reprobeGit: vitest.fn(),
    launchServer: vitest.fn(),
    cleanup: vitest.fn(async () => {})
  }
})

const { harness, windowsAtMenu, killProcessTree, launchServer, cleanup, reprobeGit } = setup
const { dialog, screen, Menu } = harness.electron

vi.mock('electron', () => harness.electron)
vi.mock('./processKill.js', () => ({ killProcessTree }))
vi.mock('./targets/serverTarget.js', () => ({ launch: launchServer }))
vi.mock('./portProbe.js', () => ({ isPortInUse: async () => false }))
vi.mock('./portOwner.js', () => ({ findPortOwner: async () => null }))
vi.mock('./processAlive.js', () => ({ isProcessAlive: () => true }))
vi.mock('./gitExec.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reprobeGit
}))
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

// The template the last setApplicationMenu was built from, and the Go items it
// marks.
const lastTemplate = () => Menu.buildFromTemplate.mock.calls.at(-1)[0]
const goChecked = () =>
  lastTemplate()
    .find((m) => m.label === 'Go')
    .submenu.filter((i) => i.checked)
    .map((i) => i.id)

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

  it('insets the native stoplights, and keeps the fixed-size window out of full screen', () => {
    const main = harness.windows.at(-1)
    expect(main.options).toMatchObject({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 },
      fullscreenable: false
    })
    expect(main.options.frame).toBeUndefined()
  })

  it('does not run the roaming settings migration', () => {
    // HTOO-543. Roaming is a Windows concept. Off Windows, a redirected
    // LOCALAPPDATA makes the roaming dir differ from the settings dir, and the
    // migration copied the real settings into the e2e temp dir.
    expect(existsSync(join(sandbox, 'Erisco', 'Epona', 'settings.json'))).toBe(false)
  })
})

describe('the application menu on macOS', () => {
  it('installs the Epona menu before any window exists', () => {
    expect(windowsAtMenu[0]).toBe(0)
    expect(lastTemplate()[0].label).toBe('Epona')
  })

  it('rebuilds the menu from a valid state report, and only on a change', () => {
    const before = Menu.setApplicationMenu.mock.calls.length
    const state = { tab: 'server', canToggleLogPane: false, logPaneOpen: false }
    harness.send('app:setMenuState', state)
    expect(Menu.setApplicationMenu.mock.calls.length).toBe(before + 1)
    expect(goChecked()).toEqual(['go:server'])

    harness.send('app:setMenuState', { ...state })
    expect(Menu.setApplicationMenu.mock.calls.length).toBe(before + 1)
  })

  it('drops a bad state report and keeps the last good menu', () => {
    const before = Menu.setApplicationMenu.mock.calls.length
    harness.send('app:setMenuState', { tab: 'settings', canToggleLogPane: 1 })
    harness.send('app:setMenuState', null)
    expect(Menu.setApplicationMenu.mock.calls.length).toBe(before)
    expect(goChecked()).toEqual(['go:server'])
  })

  it('sends a clicked item to the window as its command, then rebuilds', async () => {
    const main = harness.windows.at(-1)
    main.webContents.send.mockClear()
    const before = Menu.setApplicationMenu.mock.calls.length
    const item = lastTemplate()
      .find((m) => m.label === 'Go')
      .submenu.find((i) => i.id === 'go:legacy')

    item.click()

    expect(main.webContents.send).toHaveBeenCalledWith('menu:command', { command: 'go:legacy' })
    // The rebuild undoes a checkbox that ticked itself, until the renderer's
    // report says the tab really changed.
    await new Promise((r) => setImmediate(r))
    expect(Menu.setApplicationMenu.mock.calls.length).toBe(before + 1)
    expect(goChecked()).toEqual(['go:server'])
  })
})

describe('re-asking git after missing Command Line Tools (HTOO-512)', () => {
  // A cached "tools missing" is cleared only by a manual action, or each
  // automatic refresh would raise the system install dialog again.
  it.each(['git:listBranches', 'git:diagnoseGitRepo'])(
    '%s re-probes only when the renderer marks it manual',
    async (channel) => {
      reprobeGit.mockClear()
      await harness.invoke(channel, sandbox)
      await harness.invoke(channel, sandbox, { manual: false })
      expect(reprobeGit).not.toHaveBeenCalled()
      await harness.invoke(channel, sandbox, { manual: true })
      expect(reprobeGit).toHaveBeenCalledTimes(1)
    }
  )

  // A launch after the install must not fail on the cached answer.
  it.each([
    ['client:launch', 'nothing'],
    ['instance:start', { id: 'no-such-instance' }],
    ['instance:reset', { id: 'no-such-instance' }]
  ])('%s re-probes: a launch is a manual action', async (channel, arg) => {
    reprobeGit.mockClear()
    await harness.invoke(channel, arg)
    expect(reprobeGit).toHaveBeenCalledTimes(1)
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
    // A Dock Quit can come while another app is in front, or after ⌘H. The
    // app comes forward first, or the question does not show.
    expect(harness.app.focus).toHaveBeenCalledWith({ steal: true })
    expect(harness.app.focus.mock.invocationCallOrder.at(-1)).toBeLessThan(
      dialog.showMessageBox.mock.invocationCallOrder[0]
    )
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

  it('resets the menu for the re-created window, before its renderer reports', () => {
    // The closed window's tab must not stay marked.
    expect(goChecked()).toEqual(['go:legacy'])
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
