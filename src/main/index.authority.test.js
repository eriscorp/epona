import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { actAsNonMac } from './electronDouble.js'

// HTOO-685, through the real handlers: a renderer that saves forged settings
// cannot make Epona run a program the user did not choose.
//
// Main boots once on a real settings.json and a real grants.json in a temp
// folder. The launch targets are doubles that record what they were asked to
// run, so nothing starts.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-authority-'))
const dataDir = join(sandbox, 'Erisco', 'Epona')
const settingsFile = join(dataDir, 'settings.json')
const grantsFile = join(dataDir, 'grants.json')

const BRIGID = join(sandbox, 'brigid', 'Brigid.exe')
const SERVER = join(sandbox, 'hyb', 'Hybrasyl.dll')
const DA_CLIENT = join(sandbox, 'DA', 'Darkages.exe')
const FORGED = join(sandbox, 'evil', 'payload.exe')
const PICKED = join(sandbox, 'brigid', 'publish', 'Brigid.exe')
const WORLD = join(sandbox, 'world')

const INSTANCE = {
  id: 'inst-1',
  name: 'Server',
  mode: 'binary',
  binaryPath: SERVER,
  serverRepoPath: '',
  serverBranch: null,
  xmlRepoPath: '',
  xmlBranch: null,
  worldDirectoryId: 'wd-1',
  logDir: '',
  configFileName: '',
  redisHost: '',
  redisPort: 6379,
  redisDatabase: null,
  redisPassword: '',
  lobbyPort: 2610,
  loginPort: 2611,
  worldPort: 2612
}

function seed(over = {}) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(
    settingsFile,
    JSON.stringify({
      clientPath: DA_CLIENT,
      targets: {
        hybrasyl: { mode: 'binary', binaryPath: BRIGID, clientRepoPath: '', clientBranch: null }
      },
      instances: [INSTANCE],
      activeInstance: 'inst-1',
      worldDirectories: [{ id: 'wd-1', name: 'world', path: WORLD }],
      activeWorldDirectory: 'wd-1',
      ...over
    })
  )
}
const onDisk = () => JSON.parse(readFileSync(settingsFile, 'utf-8'))

const mocks = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  const { vi: vitest } = await import('vitest')
  return {
    harness: createElectronDouble({
      pathsBase: mkdtemp(joinPath(tmp(), 'epona-authority-paths-'))
    }),
    launchHybrasyl: vitest.fn(),
    launchServer: vitest.fn(),
    launchLegacy: vitest.fn(),
    isPortInUse: vitest.fn(async () => false),
    isProcessAlive: vitest.fn(() => true)
  }
})
const { harness, launchHybrasyl, launchServer, launchLegacy } = mocks

vi.mock('electron', () => mocks.harness.electron)
vi.mock('./targets/hybrasylTarget.js', async (importOriginal) => ({
  ...(await importOriginal()),
  launch: mocks.launchHybrasyl
}))
vi.mock('./targets/serverTarget.js', () => ({ launch: mocks.launchServer }))
vi.mock('./targets/legacyTarget.js', () => ({ launch: mocks.launchLegacy }))
vi.mock('./portProbe.js', () => ({ isPortInUse: mocks.isPortInUse }))
vi.mock('./processAlive.js', () => ({ isProcessAlive: mocks.isProcessAlive }))

let restorePlatform
beforeAll(async () => {
  restorePlatform = actAsNonMac()
  process.env.LOCALAPPDATA = sandbox
  seed()
  await import('./index.js')
  await harness.ready()
})
afterAll(() => {
  restorePlatform()
  rmSync(sandbox, { recursive: true, force: true })
})

beforeEach(() => {
  seed()
  launchHybrasyl.mockReset().mockResolvedValue({ success: true, kind: 'exe' })
  launchServer.mockReset().mockResolvedValue({ success: true, pid: 4242 })
  launchLegacy.mockReset().mockResolvedValue({ success: true })
})

const PROFILE = { id: 'p', name: 'Local', hostname: '127.0.0.1', port: 2610, redirect: false }

async function saveWith(edit) {
  const settings = await harness.invoke('settings:load')
  edit(settings)
  await harness.invoke('settings:save', settings)
  return settings
}

describe('launch grants (HTOO-685)', () => {
  it('migrates the paths in settings.json at the first start', async () => {
    // The migration runs beside the boot; the first save or launch waits for it.
    const grants = await vi.waitFor(() => JSON.parse(readFileSync(grantsFile, 'utf-8')))
    expect(grants.paths).toEqual(expect.arrayContaining([BRIGID, SERVER, DA_CLIENT]))
  })

  it('does not save a forged client binary, and launches the chosen one', async () => {
    const sent = await saveWith((s) => (s.targets.hybrasyl.binaryPath = FORGED))
    expect(onDisk().targets.hybrasyl.binaryPath).toBe(BRIGID)
    await harness.invoke('client:launch', 'hybrasyl', sent, PROFILE)
    expect(launchHybrasyl).toHaveBeenCalledTimes(1)
    expect(launchHybrasyl.mock.calls[0][0].binaryPath).toBe(BRIGID)
  })

  it('does not save a forged server binary, and starts the chosen one', async () => {
    await saveWith((s) => (s.instances[0].binaryPath = FORGED))
    expect(onDisk().instances[0].binaryPath).toBe(SERVER)
    const result = await harness.invoke('instance:start', { id: 'inst-1', binaryPath: FORGED })
    expect(result.success).toBe(true)
    expect(launchServer.mock.calls[0][0].binaryPath).toBe(SERVER)
    await harness.invoke('instance:stop', 'inst-1')
  })

  it('does not save a forged repo for a new instance', async () => {
    await saveWith((s) =>
      s.instances.push({
        ...INSTANCE,
        id: 'inst-2',
        mode: 'repo',
        binaryPath: '',
        serverRepoPath: FORGED
      })
    )
    expect(onDisk().instances.find((i) => i.id === 'inst-2').serverRepoPath).toBe('')
  })

  it('saves and launches a path that the dialog returned', async () => {
    harness.electron.dialog.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [PICKED]
    })
    expect(await harness.invoke('dialog:openFile', 'Select Hybrasyl client binary')).toBe(PICKED)
    const sent = await saveWith((s) => (s.targets.hybrasyl.binaryPath = PICKED))
    expect(onDisk().targets.hybrasyl.binaryPath).toBe(PICKED)
    expect(JSON.parse(readFileSync(grantsFile, 'utf-8')).paths).toContain(PICKED)
    await harness.invoke('client:launch', 'hybrasyl', sent, PROFILE)
    expect(launchHybrasyl.mock.calls[0][0].binaryPath).toBe(PICKED)
  })

  it('refuses to launch a path that reached settings.json without a grant', async () => {
    // A hand edit, or a file written by anything but settings:save.
    seed({
      targets: {
        hybrasyl: { mode: 'binary', binaryPath: FORGED, clientRepoPath: '', clientBranch: null }
      },
      instances: [{ ...INSTANCE, binaryPath: FORGED }]
    })
    const client = await harness.invoke('client:launch', 'hybrasyl', {}, PROFILE)
    expect(client).toMatchObject({ success: false })
    expect(client.error).toMatch(/no record that you chose/)
    const server = await harness.invoke('instance:start', { id: 'inst-1' })
    expect(server).toMatchObject({ success: false })
    expect(server.error).toMatch(/no record that you chose/)
    expect(launchHybrasyl).not.toHaveBeenCalled()
    expect(launchServer).not.toHaveBeenCalled()
  })

  it.runIf(process.platform === 'win32')('refuses a legacy client that has no grant', async () => {
    seed({ clientPath: FORGED })
    const result = await harness.invoke('client:launch', 'legacy', {}, PROFILE)
    expect(result).toMatchObject({ success: false })
    expect(launchLegacy).not.toHaveBeenCalled()
    seed()
    await harness.invoke('client:launch', 'legacy', {}, PROFILE)
    expect(launchLegacy).toHaveBeenCalledTimes(1)
  })
})
