import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  GRANTS_FILENAME,
  createLaunchGrants,
  hybrasylLaunchPaths,
  instanceLaunchPaths,
  launchPaths
} from './launchGrants.js'

// HTOO-685. On a real temp folder: grants.json is read, migrated and written
// for real.

const CLIENT = join('C:', 'DA', 'Darkages.exe')
const BRIGID = join('C:', 'brigid', 'Brigid.exe')
const CSPROJ = join('C:', 'brigid', 'Brigid.csproj')
const SERVER = join('C:', 'hyb', 'Hybrasyl.dll')
const SERVER_REPO = join('C:', 'hyb', 'server')
const XML_REPO = join('C:', 'hyb', 'xml')
const FORGED = join('C:', 'Windows', 'System32', 'calc.exe')

function settings(over = {}) {
  return {
    clientPath: CLIENT,
    targets: { hybrasyl: { mode: 'binary', binaryPath: BRIGID, clientRepoPath: CSPROJ } },
    instances: [
      { id: 'a', mode: 'binary', binaryPath: SERVER, serverRepoPath: SERVER_REPO, xmlRepoPath: '' }
    ],
    ...over
  }
}

let dir
const logs = []
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'epona-grants-'))
  logs.length = 0
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const make = (onDisk = settings(), platform = 'linux') =>
  createLaunchGrants({
    dir,
    loadSettings: async () => onDisk,
    platform,
    log: (m) => logs.push(m)
  })
const grantsOnDisk = () => JSON.parse(readFileSync(join(dir, GRANTS_FILENAME), 'utf-8'))

describe('launchPaths', () => {
  it('names each launch path, and leaves out the empty ones', () => {
    expect(launchPaths(settings()).map((p) => p.path)).toEqual([
      CLIENT,
      BRIGID,
      CSPROJ,
      SERVER,
      SERVER_REPO
    ])
  })

  it('takes only the paths a launch runs in its mode', () => {
    expect(
      hybrasylLaunchPaths({ mode: 'binary', binaryPath: BRIGID, clientRepoPath: CSPROJ })
    ).toEqual([{ where: 'targets.hybrasyl.binaryPath', path: BRIGID }])
    expect(
      hybrasylLaunchPaths({ mode: 'repo', binaryPath: BRIGID, clientRepoPath: CSPROJ })
    ).toEqual([{ where: 'targets.hybrasyl.clientRepoPath', path: CSPROJ }])
    const repo = {
      id: 'a',
      mode: 'repo',
      binaryPath: SERVER,
      serverRepoPath: SERVER_REPO,
      xmlRepoPath: XML_REPO
    }
    expect(instanceLaunchPaths(repo).map((p) => p.path)).toEqual([SERVER_REPO, XML_REPO])
    expect(instanceLaunchPaths({ ...repo, mode: 'binary' }).map((p) => p.path)).toEqual([SERVER])
  })
})

describe('createLaunchGrants', () => {
  it('migrates the paths in settings.json once, when grants.json does not exist', async () => {
    const g = make()
    await g.ready
    expect(grantsOnDisk().paths.sort()).toEqual(
      [CLIENT, BRIGID, CSPROJ, SERVER, SERVER_REPO].sort()
    )
    expect(g.isGranted(BRIGID)).toBe(true)
    // A second start reads the file and does not migrate again.
    const later = make(settings({ clientPath: FORGED }))
    await later.ready
    expect(later.isGranted(FORGED)).toBe(false)
  })

  it('fails closed on a grants.json that does not parse', async () => {
    writeFileSync(join(dir, GRANTS_FILENAME), '{ not json')
    const g = make()
    await g.ready
    expect(g.isGranted(BRIGID)).toBe(false)
    expect(logs.join('\n')).toMatch(/not valid/)
  })

  it('refuses a forged path in a save, and keeps the value from before', async () => {
    const g = make()
    await g.ready
    const next = settings({
      targets: { hybrasyl: { mode: 'binary', binaryPath: FORGED, clientRepoPath: CSPROJ } }
    })
    const { settings: clean, refused } = await g.reconcile(next, settings())
    expect(clean.targets.hybrasyl.binaryPath).toBe(BRIGID)
    expect(refused).toEqual(['targets.hybrasyl.binaryPath'])
    expect(grantsOnDisk().paths).not.toContain(FORGED)
    expect(logs.join('\n')).toMatch(/refused.*targets\.hybrasyl\.binaryPath/)
  })

  it('empties a forged path when the value from before has no grant either', async () => {
    const g = make(settings({ instances: [] }))
    await g.ready
    const next = settings({
      instances: [
        { id: 'new', mode: 'binary', binaryPath: FORGED, serverRepoPath: '', xmlRepoPath: '' }
      ]
    })
    const { settings: clean } = await g.reconcile(next, settings({ instances: [] }))
    expect(clean.instances[0].binaryPath).toBe('')
  })

  it('keeps a path that a dialog returned, and records it', async () => {
    const g = make()
    await g.ready
    const picked = join('C:', 'brigid', 'publish', 'Brigid.exe')
    g.bless(picked)
    const next = settings({
      targets: { hybrasyl: { mode: 'binary', binaryPath: picked, clientRepoPath: CSPROJ } }
    })
    const { settings: clean, refused } = await g.reconcile(next, settings())
    expect(clean.targets.hybrasyl.binaryPath).toBe(picked)
    expect(refused).toEqual([])
    expect(grantsOnDisk().paths).toContain(picked)
    // The path it replaced is no longer named, so it loses its grant.
    expect(grantsOnDisk().paths).not.toContain(BRIGID)
  })

  it('lets a save copy a granted path to another field, and clear a field', async () => {
    const g = make()
    await g.ready
    const next = settings({
      clientPath: '',
      instances: [
        {
          id: 'a',
          mode: 'binary',
          binaryPath: SERVER,
          serverRepoPath: SERVER_REPO,
          xmlRepoPath: ''
        },
        { id: 'b', mode: 'binary', binaryPath: SERVER, serverRepoPath: '', xmlRepoPath: '' }
      ]
    })
    const { settings: clean, refused } = await g.reconcile(next, settings())
    expect(refused).toEqual([])
    expect(clean.clientPath).toBe('')
    expect(clean.instances[1].binaryPath).toBe(SERVER)
  })

  it('reports the first path with no grant, for a launch', async () => {
    const g = make()
    await g.ready
    expect(g.denied(launchPaths({ clientPath: CLIENT }))).toBeNull()
    expect(g.denied(launchPaths({ clientPath: FORGED }))).toEqual({
      where: 'clientPath',
      path: FORGED
    })
  })

  it('folds case on Windows only', async () => {
    const win = make(settings(), 'win32')
    await win.ready
    expect(win.isGranted(BRIGID.toUpperCase())).toBe(true)
    rmSync(join(dir, GRANTS_FILENAME))
    const posix = make(settings(), 'linux')
    await posix.ready
    expect(posix.isGranted(BRIGID.toUpperCase())).toBe(false)
  })

  it('does not rewrite grants.json when the paths are the same', async () => {
    const g = make()
    await g.ready
    rmSync(join(dir, GRANTS_FILENAME))
    await g.reconcile(settings(), settings())
    expect(existsSync(join(dir, GRANTS_FILENAME))).toBe(false)
  })
})
