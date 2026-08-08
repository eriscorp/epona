// Opening a Wise installer: overlay -> streams -> WiseScript.bin -> file table.
//
// The overlay is a chain of raw DEFLATE streams, each followed by a 4-byte CRC32
// of its own inflated bytes. The first is a palette bitmap the installer draws
// with, the second is WiseScript.bin, and the rest are file data — both the
// client's files and the installer's own scratch files, interleaved.
//
// Two things this module has to work out, because nothing in the file states
// them outright:
//
//  1. WiseScript.bin, which means walking the first two streams.
//  2. `dataBase` — the file offset that the script's deflateStart values are
//     measured from. They are NOT absolute file offsets; they start at 0 for the
//     first file entry. The base is a stream boundary, so we walk boundaries and
//     test each one against the file table until the installer's own CRC32
//     confirms a fit.
//
// That confirmation is what licenses the scanning approach in wiseScript.js. A
// wrong base, or a false-positive candidate, disagrees with a stored CRC32
// almost immediately; a right one agrees for every entry. Measured on the retail
// DarkAges741single.exe: 104 entries, 104 CRC32 matches, 582.7 MiB inflated.

import { promises as fs } from 'fs'
import { createInflateRaw, inflateRawSync, crc32 } from 'zlib'
import { findOverlayOffset } from './peOverlay.js'
import {
  findFileEntryCandidates,
  isClientFileEntry,
  clientRelativePath,
  TRAILING_CRC_SIZE
} from './wiseScript.js'

// Enough to hold the DOS and PE headers plus the section table of any real stub.
const HEADER_READ_SIZE = 64 * 1024

// How much of the overlay to buffer while hunting for WiseScript.bin and the
// data base. The retail installer needs ~120 KB; this starts generously and
// grows rather than assuming.
const INITIAL_OVERLAY_READ = 1024 * 1024
const MAX_OVERLAY_READ = 64 * 1024 * 1024

// The file data block begins within the first handful of streams. Walking far
// past that means we are not looking at a Wise installer of the shape we know.
const MAX_STREAMS_TO_WALK = 64

// A CRC32 of 0 in the script means "not recorded", so those entries can only be
// confirmed by inflating them. Bounded so a hostile file cannot make us inflate
// gigabytes during what is supposed to be a cheap manifest read.
const MAX_UNRECORDED_CRC_VALIDATE = 8 * 1024 * 1024

// The deflate chain does not begin at the overlay offset. A Wise header sits in
// front of it, holding the wizard's font name and captions — 170 bytes in the
// Dark Ages installer. Its layout varies with those strings and is not documented
// anywhere we trust, so we find the first stream by probing instead of parsing.
const MAX_WISE_HEADER_SCAN = 8192

// Ceiling for a probe inflate. The first stream is the installer's palette bitmap
// (16 KB in the Dark Ages installer); this is well clear of that while stopping a
// bogus offset from inflating something enormous before it fails.
const PROBE_MAX_OUTPUT = 16 * 1024 * 1024

export class NotAWiseInstallerError extends Error {
  constructor(detail) {
    super(`Not a Dark Ages installer: ${detail}`)
    this.name = 'NotAWiseInstallerError'
    this.reason = 'not-an-installer'
  }
}

// Inflates one raw DEFLATE stream starting at `offset`, reporting how much input
// it consumed so the caller can find the next one.
//
// zlib's sync helpers cannot report consumed input, so this uses the streaming
// engine and its bytesWritten counter — for an inflate stream, the count of
// compressed bytes fed in.
export function inflateStreamAt(buffer, offset) {
  return new Promise((resolve, reject) => {
    if (offset >= buffer.length) {
      reject(new NotAWiseInstallerError('overlay stream starts past the end of the file'))
      return
    }
    const engine = createInflateRaw()
    const chunks = []
    engine.on('data', (chunk) => chunks.push(chunk))
    engine.on('end', () => {
      resolve({ data: Buffer.concat(chunks), compressedLength: engine.bytesWritten })
    })
    engine.on('error', reject)
    engine.end(buffer.subarray(offset))
  })
}

// Finds where the deflate chain starts inside the overlay, by trying each offset
// until one inflates AND agrees with the CRC32 stored immediately after it.
//
// The CRC32 agreement is what makes this safe rather than a guess: a stream that
// decompresses by accident at the wrong offset will not also be followed by four
// bytes matching its own checksum.
async function findFirstStreamOffset(overlay) {
  const limit = Math.min(MAX_WISE_HEADER_SCAN, overlay.length)
  for (let offset = 0; offset < limit; offset++) {
    // Cheap rejection first: BTYPE 3 is not a legal DEFLATE block type, and a
    // sync probe is far cheaper to set up than a stream engine.
    if (((overlay[offset] >> 1) & 0x03) === 0x03) continue
    try {
      inflateRawSync(overlay.subarray(offset), { maxOutputLength: PROBE_MAX_OUTPUT })
    } catch {
      continue
    }
    const { data, compressedLength } = await inflateStreamAt(overlay, offset)
    const crcAt = offset + compressedLength
    if (crcAt + TRAILING_CRC_SIZE > overlay.length) continue
    if (overlay.readUInt32LE(crcAt) === crc32Of(data)) return offset
  }
  return null
}

// Walks the stream chain from `offset`, yielding each stream's start offset. Used
// both to reach WiseScript.bin and to enumerate candidate data bases.
async function walkStreamBoundaries(overlay, offset, limit) {
  const boundaries = []
  let cursor = offset
  for (let i = 0; i < limit; i++) {
    boundaries.push(cursor)
    let stream
    try {
      stream = await inflateStreamAt(overlay, cursor)
    } catch {
      break
    }
    cursor += stream.compressedLength + TRAILING_CRC_SIZE
    if (cursor >= overlay.length) break
  }
  return boundaries
}

// zlib owns the CRC32 table, so we never hand-roll one. `>>> 0` because the
// script stores it unsigned and zlib hands back a signed 32-bit value.
function crc32Of(buffer) {
  return crc32(buffer) >>> 0
}

// Reads the installer's manifest: which files it would write, and where their
// compressed bytes live.
//
// Returns { overlayOffset, dataBase, entries, clientFiles, skipped } where
// `clientFiles` are the %MAINDIR% entries with a destination-relative path
// attached, and `skipped` records entries we could not confirm, so a caller can
// report them rather than silently shipping an incomplete tree.
export async function readWiseManifest(installerPath) {
  const handle = await fs.open(installerPath, 'r')
  try {
    const stat = await handle.stat()
    const head = Buffer.alloc(Math.min(HEADER_READ_SIZE, stat.size))
    await handle.read(head, 0, head.length, 0)
    const overlayOffset = findOverlayOffset(head)
    if (overlayOffset >= stat.size) {
      throw new NotAWiseInstallerError('the file has no data appended after its last section')
    }

    let readSize = INITIAL_OVERLAY_READ
    let attempt = 0
    for (;;) {
      attempt++
      const overlayLength = Math.min(readSize, stat.size - overlayOffset)
      const overlay = Buffer.alloc(overlayLength)
      await handle.read(overlay, 0, overlayLength, overlayOffset)

      const result = await tryReadManifest(handle, overlay, overlayOffset, stat.size)
      if (result) return { overlayOffset, ...result }

      if (overlayLength >= stat.size - overlayOffset || readSize >= MAX_OVERLAY_READ) {
        throw new NotAWiseInstallerError(
          attempt === 1
            ? 'the appended data is not a Wise payload'
            : 'could not locate the installer file table'
        )
      }
      readSize = Math.min(readSize * 4, MAX_OVERLAY_READ)
    }
  } finally {
    await handle.close()
  }
}

async function tryReadManifest(handle, overlay, overlayOffset, fileSize) {
  const firstStream = await findFirstStreamOffset(overlay)
  if (firstStream === null) return null

  // The first stream is the palette bitmap the wizard draws with; the second is
  // WiseScript.bin. Neither is a client file.
  let colors
  try {
    colors = await inflateStreamAt(overlay, firstStream)
  } catch {
    return null
  }
  const scriptOffset = firstStream + colors.compressedLength + TRAILING_CRC_SIZE
  let script
  try {
    script = await inflateStreamAt(overlay, scriptOffset)
  } catch {
    return null
  }

  const payloadSize = fileSize - overlayOffset
  const candidates = findFileEntryCandidates(script.data, payloadSize)
  if (candidates.length === 0) return null

  // Read a 32-bit LE value at an overlay-relative offset, from the buffer when
  // it reaches and from the file when it does not.
  const scratch = Buffer.alloc(TRAILING_CRC_SIZE)
  const overlayAt = (relativeOffset) => {
    if (relativeOffset < 0 || relativeOffset + TRAILING_CRC_SIZE > payloadSize) return null
    if (relativeOffset + TRAILING_CRC_SIZE <= overlay.length) {
      return overlay.readUInt32LE(relativeOffset)
    }
    return undefined // beyond the buffer; caller falls back to a file read
  }
  const readUInt32 = async (relativeOffset) => {
    const buffered = overlayAt(relativeOffset)
    if (buffered !== undefined) return buffered
    await handle.read(scratch, 0, TRAILING_CRC_SIZE, overlayOffset + relativeOffset)
    return scratch.readUInt32LE(0)
  }

  const relativeBase = await resolveDataBase(
    overlay,
    firstStream,
    candidates,
    readUInt32,
    payloadSize
  )
  if (relativeBase === null) return null

  const { entries, skipped } = await confirmEntries(candidates, relativeBase, readUInt32, overlay)
  if (entries.length === 0) return null

  const clientFiles = entries
    .filter(isClientFileEntry)
    .map((entry) => ({ ...entry, relativePath: clientRelativePath(entry) }))

  // `dataBase` leaves here as an absolute file offset. Everything above works in
  // overlay-relative space, but the extractor reads byte ranges straight out of
  // the installer, so it wants a file offset and should not have to know that the
  // overlay exists.
  return {
    dataBase: overlayOffset + relativeBase,
    script: script.data,
    entries,
    clientFiles,
    skipped
  }
}

// Finds the offset the script's deflateStart values are measured from.
//
// The first file entry starts at 0, so the base is whichever stream boundary
// makes that entry's stored CRC32 agree with the script. Candidate bases come
// from the stream chain, skipping the bitmap and the script themselves.
async function resolveDataBase(overlay, firstStream, candidates, readUInt32, payloadSize) {
  const lowest = candidates.reduce(
    (min, c) => (c.deflateStart < min ? c.deflateStart : min),
    Number.POSITIVE_INFINITY
  )
  const anchors = candidates.filter((c) => c.deflateStart === lowest && c.crc32 !== 0)
  if (anchors.length === 0) return null

  const boundaries = await walkStreamBoundaries(overlay, firstStream, MAX_STREAMS_TO_WALK)
  for (const boundary of boundaries) {
    for (const anchor of anchors) {
      const end = boundary + anchor.deflateEnd
      if (end > payloadSize) continue
      const stored = await readUInt32(end - TRAILING_CRC_SIZE)
      if (stored === anchor.crc32) return boundary
    }
  }
  return null
}

// Keeps the candidates the installer's own CRC32 vouches for, and reports the
// rest. Later duplicates of a destination are dropped — a real Wise script can
// list the same path once per language, and the first match is the one whose
// data we verified.
async function confirmEntries(candidates, dataBase, readUInt32, overlay) {
  const entries = []
  const skipped = []
  const seen = new Set()

  for (const candidate of candidates) {
    const crcOffset = dataBase + candidate.deflateEnd - TRAILING_CRC_SIZE
    let confirmed = false

    if (candidate.crc32 !== 0) {
      confirmed = (await readUInt32(crcOffset)) === candidate.crc32
    } else if (candidate.inflatedSize <= MAX_UNRECORDED_CRC_VALIDATE) {
      // No CRC32 recorded, so inflate it and check the size and the stored CRC32
      // agree. Only reachable when the bytes are already buffered.
      const start = dataBase + candidate.deflateStart
      const length = candidate.deflateEnd - candidate.deflateStart - TRAILING_CRC_SIZE
      if (start + length <= overlay.length) {
        try {
          const { data } = await inflateStreamAt(overlay.subarray(0, start + length), start)
          confirmed =
            data.length === candidate.inflatedSize &&
            crc32Of(data) === (await readUInt32(crcOffset))
        } catch {
          confirmed = false
        }
      }
    }

    if (!confirmed) continue
    if (seen.has(candidate.destFile)) continue
    seen.add(candidate.destFile)
    entries.push(candidate)
  }

  // Anything that looked like a client file but could not be confirmed is worth
  // surfacing; a silently short tree is the failure mode we most want to avoid.
  for (const candidate of candidates) {
    if (seen.has(candidate.destFile)) continue
    if (!isClientFileEntry(candidate)) continue
    if (skipped.some((s) => s.destFile === candidate.destFile)) continue
    skipped.push({ destFile: candidate.destFile, reason: 'crc-unconfirmed' })
  }

  return { entries, skipped }
}
