import { promises as fs } from 'fs'

// Does a directory look like a Dark Ages installation?
//
// The Legacy tab owns `clientPath`, which is a file (Dark Ages.exe) on Windows
// and a directory of retail assets on macOS and Linux — the same value that
// reaches the Hybrasyl client as DA_ASSET_PATH. On the platforms that cannot
// launch, pointing at the wrong folder produced no error here at all: the
// launcher passed it on and the client failed later, somewhere else, for a
// reason that did not name this setting.
//
// This is a SHAPE check, not a completeness check. It answers "is this
// plausibly a Dark Ages folder" so the tab can say so before a launch is
// attempted. HTOO-288 owns real validation of an extracted tree, and should
// extend this rather than grow a second answer to the same question.
//
// Case matters here and the glob is deliberately case-insensitive. A retail
// install writes `Legend.dat`, `setoa.dat` and friends in mixed case; a tree
// unpacked by a third-party tool may have folded them. On Windows and macOS the
// filesystem hides the difference, on Linux it does not, and refusing a
// perfectly usable folder over a capital letter would be the worse failure.
// See HTOO-287 for the wider casing audit.
export async function inspectAssetDir(dirPath) {
  if (typeof dirPath !== 'string' || dirPath.length === 0) {
    return { ok: false, reason: 'unset' }
  }

  let entries
  try {
    const stat = await fs.stat(dirPath)
    if (!stat.isDirectory()) return { ok: false, reason: 'not-a-directory' }
    entries = await fs.readdir(dirPath)
  } catch {
    return { ok: false, reason: 'missing' }
  }

  const dats = entries.filter((name) => name.toLowerCase().endsWith('.dat'))
  if (dats.length === 0) return { ok: false, reason: 'no-dat-files' }
  return { ok: true, datCount: dats.length }
}
