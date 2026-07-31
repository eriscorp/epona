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

// No unit test imports this module: `__dirname` exists only in the electron-vite
// CJS bundle, not under vitest's ESM loader. The logic worth testing lives in
// src/shared/changelog.js; that this file finds the packaged file is an e2e
// concern, covered by e2e/whats-new.spec.js against a real build.
export function registerChangelogHandlers(ipcMain) {
  ipcMain.handle('changelog:read', () => readChangelog())
}
