// The environment that Epona gives to each child process (HTOO-661).
//
// Under the AppImage, two layers change Epona's environment before main runs:
//
//   - The AppImage runtime sets APPDIR (the FUSE mount), APPIMAGE (the file),
//     ARGV0 and OWD.
//   - electron-builder's AppRun puts $APPDIR entries in front of PATH,
//     XDG_DATA_DIRS, LD_LIBRARY_PATH and GSETTINGS_SCHEMA_DIR
//     (app-builder-lib/out/targets/appimage/appImageUtil.js).
//
// A child that inherits them loads libraries and data from Epona's mount. The
// mount is gone when Epona exits, and a server or a client can run for longer.
// A child Electron app that inherits APPIMAGE takes itself for an AppImage.
//
// Epona's own process.env stays as it is. GTK reads GSETTINGS_SCHEMA_DIR and
// XDG_DATA_DIRS when it first needs them (a file dialog, for example), so a
// change to process.env could change Epona's own dialogs. Only the copy that
// a child gets is changed.
//
// Every spawn and execFile in src/main passes `env: childEnv(...)`.
// childEnv.test.js pins that with a scan of the source.

/** Set by the AppImage runtime. A child has no use for them. */
export const APPIMAGE_RUNTIME_KEYS = Object.freeze(['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD'])

/** The lists that AppRun puts $APPDIR entries in front of. */
export const APPRUN_LIST_KEYS = Object.freeze([
  'PATH',
  'XDG_DATA_DIRS',
  'LD_LIBRARY_PATH',
  'GSETTINGS_SCHEMA_DIR'
])

/**
 * A copy of `env` without the AppImage's changes. When `APPIMAGE` or `APPDIR`
 * is not set, the copy is the same as `env`.
 *
 * In each list, an entry that is `$APPDIR` or is under it is removed, and the
 * other entries keep their order. AppRun only adds entries, so what is left is
 * the value from before AppRun. A list that is then empty was not set before
 * AppRun, so the copy does not set it.
 *
 * @param {Readonly<Record<string, string | undefined>>} env
 * @returns {Record<string, string | undefined>}
 */
export function stripAppImageEnv(env) {
  const copy = { ...env }
  const appDir = env['APPDIR']?.replace(/\/+$/, '')
  if (!env['APPIMAGE'] || !appDir) return copy

  const underAppDir = (entry) => entry === appDir || entry.startsWith(`${appDir}/`)
  for (const key of APPRUN_LIST_KEYS) {
    const value = copy[key]
    if (typeof value !== 'string') continue
    const kept = value.split(':').filter((entry) => entry !== '' && !underAppDir(entry))
    if (kept.length === 0) delete copy[key]
    else copy[key] = kept.join(':')
  }
  for (const key of APPIMAGE_RUNTIME_KEYS) delete copy[key]
  return copy
}

/**
 * The environment for a child process: Epona's, without the AppImage's
 * changes, with `extra` on top.
 *
 * @param {Record<string, string | undefined>} [extra]
 * @param {Readonly<Record<string, string | undefined>>} [env] For tests; `process.env` by default.
 * @returns {Record<string, string | undefined>}
 */
export function childEnv(extra = {}, env = process.env) {
  return { ...stripAppImageEnv(env), ...extra }
}
