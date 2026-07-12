import { detectProtectedLocation } from '../../shared/protectedPaths.js'

// Translate a native CreateProcess failure into an actionable message. The
// da-win32 addon throws `Error("CreateProcess failed: <n>")` where <n> is the
// Win32 GetLastError code, so we parse it out and map the ones users actually
// hit. Anything else falls through to the raw message. Kept dependency-free
// (no native addon import) so it's unit-testable outside Electron.
export function describeLaunchError(err, clientPath) {
  const code = Number(/CreateProcess failed: (\d+)/.exec(err.message)?.[1])
  // 740 = ERROR_ELEVATION_REQUIRED — the client needs admin rights, which almost
  // always means it's in a protected folder Epona can't launch it from.
  if (code === 740) {
    const where = detectProtectedLocation(clientPath)
    const inside = where ? ` like ${where}` : ''
    return (
      `Windows blocked the Dark Ages client because it requires administrator ` +
      `rights (error 740). This usually happens when the client is inside a ` +
      `protected folder${inside}. Move your Dark Ages folder to a normal ` +
      `location such as C:\\DarkAges and re-locate the client.`
    )
  }
  // 2/3 = ERROR_FILE_NOT_FOUND / ERROR_PATH_NOT_FOUND.
  if (code === 2 || code === 3) {
    return `Couldn't find the Dark Ages client at ${clientPath}. Use Locate Client to pick Darkages.exe again.`
  }
  return err.message
}
