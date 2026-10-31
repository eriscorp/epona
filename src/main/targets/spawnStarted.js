// Whether a spawned child started. `spawn()` returns before the OS has run the
// program, and a failure (ENOENT for a missing `dotnet`, EACCES, a quarantined
// apphost) arrives later as an 'error' event. A launch that returned at once
// reported success with no pid while nothing ran (HTOO-594).
//
// Resolves null on the child's 'spawn' event, or the error. The listener stays
// on, so a later 'error' (a failed kill) is not an uncaught exception for a
// child that nothing else listens to (`stdio: 'ignore'`).
export function spawnStarted(child) {
  return new Promise((resolve) => {
    child.once('spawn', () => resolve(null))
    child.on('error', (err) => resolve(err))
  })
}

// errno -86 is EBADARCH on macOS: an x86_64-only program on Apple Silicon with
// no Rosetta. Node reports it only as "Unknown system error -86".
const EBADARCH = -86

/**
 * A spawn failure in words a user can act on.
 *
 * @param {NodeJS.ErrnoException} err
 * @returns {string}
 */
export function describeSpawnError(err) {
  if (err.errno === EBADARCH || /Unknown system error -86\b/.test(err.message)) {
    return 'wrong CPU type: this program needs Rosetta or an arm64 build'
  }
  if (err.code === 'EACCES') {
    return `${err.message}. Check that the file is executable (chmod +x).`
  }
  return err.message
}
