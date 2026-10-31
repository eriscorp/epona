// Open a folder in the OS file manager, and say whether it opened.
// shell.openPath resolves '' on success and an error string on failure. The
// Reveal buttons threw that string away, so on a desktop with no handler for
// folders a click did nothing at all (HTOO-658, L6 on the Linux box).
//
// @param {{ openPath: (path: string) => Promise<string> }} shell Electron's shell
// @param {string} dir
// @returns {Promise<{ ok: true, path: string } | { ok: false, path: string, error: string }>}
export async function openFolder(shell, dir) {
  const error = await shell.openPath(dir)
  return error ? { ok: false, path: dir, error } : { ok: true, path: dir }
}
