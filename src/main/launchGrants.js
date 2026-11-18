// The programs and repositories that Epona may run (HTOO-685).
//
// The renderer writes settings.json through `settings:save`, so settings.json is
// not the record of what Epona may start. A compromised renderer could save any
// path as a client or a server binary and then ask for a launch. This module
// keeps that record in `grants.json`, beside settings.json, and only main writes
// it.
//
// A path gets a grant from one of three sources:
//
//   1. A native dialog result in this session (`bless`). The user chose it.
//   2. A path that main computes itself: the folder and the program that a Dark
//      Ages install unpacked (`bless` again, from the install handler).
//   3. The one-time migration. When grants.json does not exist, the launch
//      paths that settings.json already names are granted once.
//
// `settings:save` passes the renderer's settings through `reconcile`. A launch
// path that has no grant is not saved: the field keeps its value from before
// the save, or becomes empty. So a save can keep or remove a grant, and never
// add one. Each launch checks the grant again (`denied`), so a path that reached
// settings.json in another way (a hand edit, a grants.json that did not parse)
// does not run.
//
// The grant is the exact path. Taliesin and Creidhne also record a SHA-256 and
// refuse a program that changed. Epona does not (Sabrael, 2026-11-17): it runs
// Brigid and server builds that change at each rebuild, and no IPC lets the
// renderer write a program's bytes. docs/authority-model.md has the whole model.

import { promises as nodeFs } from 'fs'
import { dirname, join, resolve } from 'path'
import { z } from 'zod'

export const GRANTS_FILENAME = 'grants.json'
export const GRANTS_VERSION = 1

const grantsFileSchema = z.object({
  version: z.literal(GRANTS_VERSION),
  paths: z.array(z.string().min(1))
})

/**
 * Every launch path that a settings snapshot names, with where it is. Empty
 * values are left out: an empty field runs nothing.
 *
 * - `clientPath`: the legacy client on Windows (Darkages.exe), and the Dark
 *   Ages folder elsewhere.
 * - The Hybrasyl client: its binary, and the .csproj that `dotnet run` builds.
 * - Each server instance: its binary, the server repo that `dotnet run` builds,
 *   and the Hybrasyl.Xml repo that the build takes as a project reference.
 *
 * @param {object} settings
 * @returns {{ where: string, path: string }[]}
 */
export function launchPaths(settings) {
  const out = []
  const add = (where, path) => {
    if (typeof path === 'string' && path.length > 0) out.push({ where, path })
  }
  add('clientPath', settings?.clientPath)
  const hybrasyl = settings?.targets?.hybrasyl
  add('targets.hybrasyl.binaryPath', hybrasyl?.binaryPath)
  add('targets.hybrasyl.clientRepoPath', hybrasyl?.clientRepoPath)
  for (const inst of Array.isArray(settings?.instances) ? settings.instances : []) {
    add(`instances[${inst?.id}].binaryPath`, inst?.binaryPath)
    add(`instances[${inst?.id}].serverRepoPath`, inst?.serverRepoPath)
    add(`instances[${inst?.id}].xmlRepoPath`, inst?.xmlRepoPath)
  }
  return out
}

/** The paths a Hybrasyl client launch runs, in its current mode. */
export function hybrasylLaunchPaths(target) {
  if (target?.mode === 'repo')
    return launchPaths({ targets: { hybrasyl: { clientRepoPath: target.clientRepoPath } } })
  return launchPaths({ targets: { hybrasyl: { binaryPath: target?.binaryPath } } })
}

/** The paths a server instance launch runs, in its current mode. */
export function instanceLaunchPaths(instance) {
  const only =
    instance?.mode === 'repo'
      ? {
          id: instance.id,
          serverRepoPath: instance.serverRepoPath,
          xmlRepoPath: instance.xmlRepoPath
        }
      : { id: instance?.id, binaryPath: instance?.binaryPath }
  return launchPaths({ instances: [only] })
}

/**
 * @param {object} options
 * @param {string} options.dir The settings folder; grants.json goes in it.
 * @param {() => Promise<object>} options.loadSettings For the one-time migration.
 * @param {string} [options.platform]
 * @param {typeof nodeFs} [options.fs]
 * @param {(message: string) => void} [options.log]
 */
export function createLaunchGrants({
  dir,
  loadSettings,
  platform = process.platform,
  fs = nodeFs,
  log = () => undefined
}) {
  const file = join(dir, GRANTS_FILENAME)
  // Windows paths ignore case, and a dialog and a hand edit can differ in it.
  const key = (p) => {
    const abs = resolve(p)
    return platform === 'win32' ? abs.toLowerCase() : abs
  }
  /** Persisted grants, by key. */
  let granted = new Map()
  /** Dialog results and main-computed paths of this session, by key. */
  const session = new Set()

  async function write(paths) {
    const data = { version: GRANTS_VERSION, paths: [...paths].sort() }
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, file)
  }

  function setGranted(paths) {
    granted = new Map(paths.map((p) => [key(p), p]))
  }

  async function load() {
    let raw = null
    try {
      raw = await fs.readFile(file, 'utf-8')
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
    }
    if (raw !== null) {
      try {
        setGranted(grantsFileSchema.parse(JSON.parse(raw)).paths)
      } catch (err) {
        // Fail closed: the user picks each program again.
        log(`grants.json is not valid and was ignored: ${err?.message ?? err}`)
        setGranted([])
      }
      return
    }
    // The one-time migration: accept what settings.json names, once.
    const paths = launchPaths(await loadSettings()).map((p) => p.path)
    setGranted(paths)
    await write(granted.values())
    if (paths.length > 0) log(`grants.json created from settings.json with ${paths.length} path(s)`)
  }

  // Never rejects: a grants.json that cannot be read is an empty grant set.
  const ready = load().catch((err) => {
    log(`grants.json could not be read, so no path has a grant: ${err?.message ?? err}`)
    setGranted([])
  })

  function isGranted(path) {
    if (typeof path !== 'string' || path.length === 0) return false
    const k = key(path)
    return granted.has(k) || session.has(k)
  }

  return {
    /** Settles when grants.json is loaded or migrated. */
    ready,

    /** Record a path that a native dialog returned, or that main computed. */
    bless(path) {
      if (typeof path === 'string' && path.length > 0) session.add(key(path))
    },

    isGranted,

    /**
     * The first path in `paths` with no grant, or null when each has one.
     *
     * @param {{ where: string, path: string }[]} paths
     */
    denied(paths) {
      return paths.find((p) => !isGranted(p.path)) ?? null
    },

    /**
     * The settings to save: `next` with each launch path that has no grant put
     * back to its value in `prev` (when that value has a grant) or emptied.
     * Then grants.json holds the launch paths of the result, and nothing else.
     * Await `ready` first.
     *
     * @param {object} next The renderer's settings, after the schema.
     * @param {object} prev The settings on disk before this save.
     * @returns {Promise<{ settings: object, refused: string[] }>}
     */
    async reconcile(next, prev) {
      const refused = []
      const keep = (where, value, before) => {
        if (typeof value !== 'string' || value.length === 0 || isGranted(value)) return value
        refused.push(where)
        return isGranted(before) ? before : ''
      }
      const prevInstances = new Map(
        (Array.isArray(prev?.instances) ? prev.instances : []).map((i) => [i.id, i])
      )
      const settings = {
        ...next,
        clientPath: keep('clientPath', next.clientPath, prev?.clientPath),
        targets: {
          ...next.targets,
          hybrasyl: {
            ...next.targets.hybrasyl,
            binaryPath: keep(
              'targets.hybrasyl.binaryPath',
              next.targets.hybrasyl.binaryPath,
              prev?.targets?.hybrasyl?.binaryPath
            ),
            clientRepoPath: keep(
              'targets.hybrasyl.clientRepoPath',
              next.targets.hybrasyl.clientRepoPath,
              prev?.targets?.hybrasyl?.clientRepoPath
            )
          }
        },
        instances: next.instances.map((inst) => {
          const before = prevInstances.get(inst.id)
          return {
            ...inst,
            binaryPath: keep(
              `instances[${inst.id}].binaryPath`,
              inst.binaryPath,
              before?.binaryPath
            ),
            serverRepoPath: keep(
              `instances[${inst.id}].serverRepoPath`,
              inst.serverRepoPath,
              before?.serverRepoPath
            ),
            xmlRepoPath: keep(
              `instances[${inst.id}].xmlRepoPath`,
              inst.xmlRepoPath,
              before?.xmlRepoPath
            )
          }
        })
      }
      for (const where of refused)
        log(`settings:save refused a launch path with no grant: ${where}`)

      const paths = launchPaths(settings).map((p) => p.path)
      const keys = new Set(paths.map(key))
      const changed = keys.size !== granted.size || [...keys].some((k) => !granted.has(k))
      if (changed) {
        // grants.json first: if the settings write then fails, a grant names a
        // path that settings.json does not, which runs nothing.
        setGranted(paths)
        await write(granted.values())
      }
      return { settings, refused }
    }
  }
}
