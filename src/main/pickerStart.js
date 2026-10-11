import { promises as fs } from 'fs'
import { basename, dirname, isAbsolute, join } from 'path'

// Where a file or folder picker opens (HTOO-553). Since Electron 43 a dialog with
// no `defaultPath` opens in Downloads, not in the last folder used. So every
// dialog goes through `withPickerStart`, which fills `defaultPath` in: the path
// the renderer named if it is usable, then the last folder picked this session,
// then Documents, then home. A stale candidate (a folder since moved) is skipped
// rather than handed to the dialog, which would fall back to Downloads again.
//
// The rule wraps the dialog, the way `guardIpc` wraps `ipcMain`, so a picker
// added later cannot forget it. Ported from taliesin's src/main/pickerStart.ts.
// Epona's renderer already names each picker's own setting, so there is no
// settings-backed candidate here: reading settings from a picker is unsafe,
// because a recovering `load()` writes the backup back over a save in flight.

/**
 * Async on purpose: a sync check against a folder on a network share that has
 * gone away blocks the main process for seconds.
 */
const pathExists = (p) =>
  fs.access(p).then(
    () => true,
    () => false
  )

/** The first candidate that is a non-empty string and exists on disk. */
export async function pickerStartPath(candidates, exists = pathExists) {
  for (const p of candidates) {
    if (p && (await exists(p))) return p
  }
  return undefined
}

/**
 * The `defaultPath` for one dialog, from what the renderer asked for and the
 * start folder. `start` is called only when the request cannot be used as it is.
 *
 * - A save keeps a path whose folder exists: the file is usually new. A stale
 *   or bare name ("server.log") goes in the start folder, because without a
 *   folder Electron 43+ puts it in Downloads.
 * - An open keeps a path that exists, or else the folder it was in. Otherwise
 *   it opens at the start folder, with no name: a name it cannot find helps
 *   nobody.
 */
export async function dialogDefaultPath(given, start, kind, exists = pathExists) {
  // The renderer's value crosses IPC untyped; taliesin's TypeScript types it.
  if (typeof given !== 'string') given = undefined
  if (given && isAbsolute(given)) {
    if (kind === 'open' && (await exists(given))) return given
    if (await exists(dirname(given))) return kind === 'save' ? given : dirname(given)
  }
  const dir = await start()
  if (kind === 'open' || !given) return dir
  if (!dir) return given
  return join(dir, isAbsolute(given) ? basename(given) : given)
}

/**
 * A dialog that fills `defaultPath` in, and remembers the folder of each pick.
 * Keeps Electron's `(window, options)` call shape.
 *
 * @param {{ showOpenDialog: Function, showSaveDialog: Function }} dialog
 * @param {{ fallbacks: () => string[], exists?: (p: string) => Promise<boolean> }} sources
 */
export function withPickerStart(dialog, sources) {
  const exists = sources.exists ?? pathExists
  let lastPickedDir
  const start = () => pickerStartPath([lastPickedDir, ...sources.fallbacks()], exists)

  return {
    async showOpenDialog(win, opts) {
      const r = await dialog.showOpenDialog(win, {
        ...opts,
        defaultPath: await dialogDefaultPath(opts.defaultPath, start, 'open', exists)
      })
      const picked = r.filePaths[0]
      if (picked) {
        lastPickedDir = opts.properties?.includes('openDirectory') ? picked : dirname(picked)
      }
      return r
    },
    async showSaveDialog(win, opts) {
      const r = await dialog.showSaveDialog(win, {
        ...opts,
        defaultPath: await dialogDefaultPath(opts.defaultPath, start, 'save', exists)
      })
      if (r.filePath) lastPickedDir = dirname(r.filePath)
      return r
    }
  }
}
