// Reading the file table out of WiseScript.bin.
//
// WiseScript.bin is the second deflate stream in a Wise installer's overlay. It
// is a bytecode-ish stream: a one-byte operation code, then a struct whose shape
// depends on that code. Operation 0x00 is the one that matters here — it
// describes a file the installer would write, and carries the destination path,
// the inflated size, a CRC32, and where the file's deflate data sits.
//
//   offset  size  field
//   0       1     operation code, 0x00
//   1       2     unknown (flag bytes; not always zero)
//   3       4     deflateStart
//   7       4     deflateEnd
//   11      2     MS-DOS date
//   13      2     MS-DOS time
//   15      4     inflatedSize
//   19      20    unknown (usually but NOT always zero)
//   39      4     crc32 of the inflated file, or 0 meaning "not recorded"
//   43      ...   destination path, NUL-terminated
//
// Layout credit to REWise (https://codeberg.org/CYBERDEV/REWise), which
// documents the struct; the code here is written against that description rather
// than ported from it. See docs/da-installer.md.
//
// WHY A SCAN AND NOT A FULL INTERPRETER. Walking the script properly means
// knowing the size of every operation, and the format is not fully understood —
// REWise itself flags operation 0x18 as unknown and its size as installer-
// dependent. One mis-sized operation desynchronises the whole remaining parse.
// So this module does not try: it scans every byte offset for something shaped
// like an operation 0x00 header and lets the caller confirm each candidate
// against the installer's own CRC32. That check is what makes the approach
// sound, and it is the caller's job — see wiseArchive.js.
//
// Pure buffer arithmetic, no fs, so the whole table is testable from a
// hand-built fixture.

export const DEST_FILE_OFFSET = 43

// The trailing CRC32 that follows each deflate stream is inside the
// [deflateStart, deflateEnd) span, so the compressed data is four bytes shorter
// than the span. Verified against the real installer: every one of its entries
// inflates to its advertised size when the span is read this way, and none do
// when it is read as compressed-data-only.
export const TRAILING_CRC_SIZE = 4

// Sanity bounds. A candidate outside these cannot be a real entry, and rejecting
// it early saves the caller an inflate attempt.
const MAX_DEST_PATH = 260 // Windows MAX_PATH; Wise predates long paths
const MAX_INFLATED_SIZE = 0x7fffffff

// ZERO-LENGTH ENTRIES ARE DELIBERATELY NOT EXTRACTED.
//
// An entry advertising 0 inflated bytes is indistinguishable, on the cheap
// checks available here, from the runs of 0x00 that pad the script — and an empty
// file's CRC32 is itself 0, which is the same value the format uses for "no
// checksum recorded", so there is nothing left to confirm it with. Accepting them
// would mean scattering spurious empty files through the client tree on every
// false positive, which is a worse outcome than omitting a genuine empty one.
//
// In the retail DarkAges741single.exe this costs exactly one file: `usa.nfo`, an
// empty release-note placeholder the client never reads. Every file the client
// loads has a non-zero length. Revisit only if a real, needed empty file appears.

// Destination paths are written with a Wise variable as the root: %MAINDIR% for
// the install directory, %TEMP% for the installer's own scratch files,
// %UNINSTALL_PATH% for the uninstaller. Only %MAINDIR% entries are client files.
export const INSTALL_DIR_VARIABLE = '%MAINDIR%'

// Reads one NUL-terminated latin1 string. Wise predates UTF-8, and the Dark Ages
// installer's paths are plain ASCII; latin1 round-trips any high bytes without
// throwing, which is what we want for a path we are about to reject anyway.
function readCString(buffer, start, limit) {
  let end = start
  const stop = Math.min(buffer.length, start + limit)
  while (end < stop && buffer[end] !== 0x00) end++
  if (end === stop) return null // unterminated within the limit
  return buffer.toString('latin1', start, end)
}

function isPrintableAscii(text) {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}

// Every byte offset that could begin an operation 0x00 header, as unvalidated
// candidates. Expect false positives — that is the design; the caller verifies.
//
// `payloadSize` is the number of bytes of overlay available for file data, used
// only to reject spans that could not possibly fit.
export function findFileEntryCandidates(script, payloadSize) {
  if (!Buffer.isBuffer(script)) return []
  const candidates = []
  const last = script.length - DEST_FILE_OFFSET - 2

  for (let at = 0; at <= last; at++) {
    if (script[at] !== 0x00) continue

    const deflateStart = script.readUInt32LE(at + 3)
    const deflateEnd = script.readUInt32LE(at + 7)
    const inflatedSize = script.readUInt32LE(at + 15)
    const crc32 = script.readUInt32LE(at + 39)

    // A span has to hold at least its own trailing CRC32 plus a byte of data.
    if (deflateEnd <= deflateStart + TRAILING_CRC_SIZE) continue
    if (inflatedSize === 0 || inflatedSize > MAX_INFLATED_SIZE) continue
    if (Number.isFinite(payloadSize) && deflateEnd > payloadSize) continue

    const destFile = readCString(script, at + DEST_FILE_OFFSET, MAX_DEST_PATH)
    if (destFile === null || destFile.length === 0) continue
    if (!isPrintableAscii(destFile)) continue

    candidates.push({ at, deflateStart, deflateEnd, inflatedSize, crc32, destFile })
  }
  return candidates
}

// Splits a Wise destination path into the root variable and the rest.
// '%MAINDIR%\\npc\\npcbase.dat' -> { variable: '%MAINDIR%', rest: 'npc\\npcbase.dat' }
// A path with no variable root, or nothing after it, yields a null rest.
export function splitDestPath(destFile) {
  const match = /^(%[A-Za-z_0-9]+%)[\\/]?(.*)$/.exec(destFile)
  if (!match) return { variable: null, rest: null }
  return { variable: match[1], rest: match[2].length > 0 ? match[2] : null }
}

// Is this entry a client file that belongs in the extracted tree?
//
// Rejects the installer's own plumbing: %TEMP% scratch files (whose names are
// themselves unexpanded variables), the uninstaller, the shortcut entries. Also
// rejects anything that would escape the destination directory — a Wise script
// cannot normally express that, but this output becomes filesystem paths and the
// check costs nothing.
export function isClientFileEntry(entry) {
  const { variable, rest } = splitDestPath(entry.destFile)
  if (variable !== INSTALL_DIR_VARIABLE || rest === null) return false
  // An unexpanded variable anywhere in the remainder means we cannot know the
  // real name, so we must not guess one.
  if (rest.includes('%')) return false
  const segments = rest.split(/[\\/]+/)
  if (segments.some((s) => s.length === 0 || s === '.' || s === '..')) return false
  // A drive letter or leading separator would make the join absolute.
  if (/^[A-Za-z]:/.test(rest)) return false
  return true
}

// The destination-relative POSIX path for a client entry, with the installer's
// casing preserved exactly.
//
// Casing is the whole point: the installer writes `Legend.dat`, and folding it
// to `legend.dat` breaks lookups on a case-sensitive filesystem, which is
// precisely the platform this feature exists for. Nothing here lowercases, and
// there is a test that fails if someone adds it. See HTOO-287.
export function clientRelativePath(entry) {
  const { rest } = splitDestPath(entry.destFile)
  return rest.split(/[\\/]+/).join('/')
}
