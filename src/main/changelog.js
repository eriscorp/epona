import { readFile } from 'fs/promises'
import { join } from 'path'
import { parseChangelog } from '../shared/changelog.js'

// Backing read for Settings > About > What's New. CHANGELOG.md is packaged as a
// runtime asset (see the `files` allowlist in electron-builder.yml) and resolved
// the same way as everything in resources/: relative to this bundle's own
// location. out/main is always two levels below the app root, so the path holds
// in a packaged build (…/app.asar/out/main -> …/app.asar/CHANGELOG.md), under
// `electron-vite dev`, and under the e2e harness alike. `fs` reads straight
// through an asar archive, so the file needs no asarUnpack entry.
//
// NOT app.getAppPath(): when electron is launched with a FILE argument rather
// than a directory — which is how e2e/helpers.js launches out/main/index.js —
// that returns the entry file's own directory, not the app root, and the read
// misses. It looks like the obvious call here; it is wrong for one of our three
// launch modes.
const CHANGELOG_PATH = join(__dirname, '..', '..', 'CHANGELOG.md')

// Cached after the first read: the file is immutable for the life of a build,
// and the dialog is cheap to reopen.
let cached = null

/** Read + parse the shipped CHANGELOG.md. Returns [] when it is missing or unreadable. */
export async function readChangelog() {
  if (cached) return cached
  try {
    cached = parseChangelog(await readFile(CHANGELOG_PATH, 'utf-8'))
  } catch {
    // A build that somehow shipped without the file should not break the About
    // card — the dialog renders its own "unavailable" state from an empty list.
    cached = []
  }
  return cached
}

// This used to say no unit test could import it, on the grounds that `__dirname`
// exists only in the electron-vite CJS bundle. That was wrong — vite defines
// `__dirname` per module, so `changelog.test.js` imports this file directly, and
// the relative path above resolves from `src/main` to the repository's own
// CHANGELOG.md just as it resolves from `out/main` to the packaged one. That makes
// the two-levels-up convention a unit assertion rather than only an e2e one.
//
// e2e/whats-new.spec.js still earns its place: it proves the file is actually
// PRESENT in a packaged build, which is a question about the electron-builder
// `files` allowlist and cannot be answered from the source tree.
export function registerChangelogHandlers(ipcMain) {
  ipcMain.handle('changelog:read', () => readChangelog())
}
