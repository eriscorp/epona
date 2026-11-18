// Open a server instance's log folder in the file manager (HTOO-685).
//
// The renderer used to send any path to `shell:openPath`. `shell.openPath` runs
// a program when the path is one, so that channel was a way to start a program
// with no settings round trip at all. This replaces it: the renderer sends an
// instance id, and main reads that instance's `logDir` from the saved settings.
//
// The path must be a folder. On macOS a folder can be a program: `shell.openPath`
// on `Calculator.app` starts Calculator. So on macOS a bundle is refused, by
// its `.app` name or by the `Info.plist` that each bundle holds.

import { promises as nodeFs } from 'fs'
import { extname, join } from 'path'
import { openFolder } from './openFolder.js'

async function exists(fs, path) {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * @param {object} options
 * @param {unknown} options.instanceId From the renderer.
 * @param {() => Promise<object>} options.loadSettings
 * @param {{ openPath: (path: string) => Promise<string> }} options.shell
 * @param {string} [options.platform]
 * @param {typeof nodeFs} [options.fs]
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function openInstanceLogDir({
  instanceId,
  loadSettings,
  shell,
  platform = process.platform,
  fs = nodeFs
}) {
  if (typeof instanceId !== 'string' || instanceId.length === 0) {
    return { ok: false, error: 'invalid instance' }
  }
  const settings = await loadSettings()
  const instance = settings.instances?.find((i) => i.id === instanceId)
  if (!instance) return { ok: false, error: 'instance not in saved settings — save changes first' }
  const dir = instance.logDir
  if (typeof dir !== 'string' || dir.length === 0) {
    return { ok: false, error: 'no log folder is set' }
  }
  let stat
  try {
    stat = await fs.stat(dir)
  } catch {
    return { ok: false, error: `the log folder does not exist: ${dir}` }
  }
  if (!stat.isDirectory()) return { ok: false, error: `the log folder is not a folder: ${dir}` }
  if (platform === 'darwin') {
    const bundle =
      extname(dir).toLowerCase() === '.app' ||
      (await exists(fs, join(dir, 'Info.plist'))) ||
      (await exists(fs, join(dir, 'Contents', 'Info.plist')))
    if (bundle) return { ok: false, error: `the log folder is an application bundle: ${dir}` }
  }
  return openFolder(shell, dir)
}
