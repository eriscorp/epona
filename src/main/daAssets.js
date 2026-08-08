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

// The data archives a real Dark Ages installation always has.
//
// Taken from the retail installer's own file table rather than from folklore:
// every name here is one of the 21 .dat files DarkAges741single.exe writes. The
// list is deliberately a subset — enough that no plausible folder passes by
// accident, small enough that a client which drops a peripheral archive in some
// future patch does not get called broken.
//
// Compared case-insensitively for the same reason inspectAssetDir is: the
// installer writes `Legend.dat`, a third-party unpacker may have folded it, and
// refusing a working folder over a capital letter is the worse failure. What must
// NOT be folded is the name we WRITE during extraction — see wiseScript.js.
export const EXPECTED_CLIENT_ARCHIVES = [
  'legend.dat',
  'setoa.dat',
  'hades.dat',
  'ia.dat',
  'misc.dat',
  'national.dat',
  'roh.dat',
  'seo.dat',
  'cious.dat',
  'khanpal.dat'
]

// Is this a COMPLETE Dark Ages tree, not merely a folder shaped like one?
//
// inspectAssetDir answers "does this look plausible" and is what the folder
// picker uses, because a user pointing at an existing install should not be
// second-guessed over a missing peripheral file. This is the stricter question,
// and it exists for one moment in particular: straight after an extraction, where
// we wrote the tree ourselves and therefore know exactly what should be in it. A
// short tree there means the extraction was wrong, and saying so at that point is
// far cheaper than letting the client fail later for an unrelated-looking reason.
//
// Builds on inspectAssetDir rather than re-deciding the same question — the shape
// failures ('unset', 'missing', 'not-a-directory', 'no-dat-files') come back
// unchanged, and only a tree that clears those can be judged incomplete.
export async function verifyClientTree(dirPath) {
  const shape = await inspectAssetDir(dirPath)
  if (!shape.ok) return shape

  let entries
  try {
    entries = await fs.readdir(dirPath)
  } catch {
    return { ok: false, reason: 'missing' }
  }

  const present = new Set(entries.map((name) => name.toLowerCase()))
  const missing = EXPECTED_CLIENT_ARCHIVES.filter((name) => !present.has(name))
  if (missing.length > 0) {
    return { ok: false, reason: 'incomplete-client', missing, datCount: shape.datCount }
  }
  return { ok: true, datCount: shape.datCount, complete: true }
}
