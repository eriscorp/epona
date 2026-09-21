// Writing the client tree out of a Wise installer.
//
// Each file is streamed — read the byte range, inflate, write, hash — so peak
// memory stays flat regardless of the file. That matters here: the retail
// installer expands to 582 MiB and single members reach 78 MiB, so buffering a
// whole file to verify it before writing is not free.
//
// Output is staged, never written straight into the destination. An interrupted
// or failed extraction must not leave something that `inspectAssetDir` would
// then call a usable Dark Ages folder — a half-written tree with a few .dat
// files in it is exactly the shape that check accepts. So files land in a
// sibling staging directory and are moved into place only once every entry has
// inflated to its advertised size with the CRC32 the installer recorded.

import { promises as fs, createReadStream, createWriteStream } from 'fs'
import { createInflateRaw, crc32 } from 'zlib'
import { pipeline } from 'stream/promises'
import { dirname, join, basename } from 'path'
import { TRAILING_CRC_SIZE } from './wiseScript.js'

export class ExtractionError extends Error {
  constructor(message, reason) {
    super(message)
    this.name = 'ExtractionError'
    this.reason = reason
  }
}

export class ExtractionCancelledError extends Error {
  constructor() {
    super('Extraction cancelled')
    this.name = 'ExtractionCancelledError'
    this.reason = 'cancelled'
  }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) throw new ExtractionCancelledError()
}

// The staging directory is `<destination>.epona-incomplete-<pid>`, a sibling of
// the destination so promotion is a same-volume rename.
const STAGING_INFIX = '.epona-incomplete-'

function stagingDirFor(destinationDir, pid) {
  return join(dirname(destinationDir), `${basename(destinationDir)}${STAGING_INFIX}${pid}`)
}

// Is `pid` a live process? `process.kill(pid, 0)` sends no signal — it only runs
// the existence check and throws when there is nothing there. EPERM means it
// exists and we may not signal it, which for this purpose is alive. A copy of
// src/main/processAlive.js, kept here so this directory stays a self-contained
// vendorable unit (Elatha carries it byte for byte).
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

// Removes staging directories left behind by runs that never reached their own
// cleanup — a crash, a kill, a quit that tore the process down mid-extraction.
// The `catch` below only sees a failure inside this process, and the rm at the
// start of extractClientFiles only reaches this pid's directory; every later run
// has a different pid, so nothing ever found the old ones (HTOO-462).
//
// Only a directory whose pid is dead is removed. The destination is the user's
// choice in Epona and fixed in Elatha, so the two can coincide, and a sweep that
// ignored liveness could delete the other app's in-flight staging.
async function sweepOrphanedStaging(destinationDir, isAlive = isProcessAlive) {
  const parent = dirname(destinationDir)
  const prefix = `${basename(destinationDir)}${STAGING_INFIX}`
  let entries
  try {
    entries = await fs.readdir(parent, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    const suffix = entry.name.slice(prefix.length)
    if (!/^\d+$/.test(suffix)) continue
    const pid = Number(suffix)
    if (pid === process.pid || isAlive(pid)) continue
    await fs.rm(join(parent, entry.name), { recursive: true, force: true }).catch(() => {})
  }
}

// Inflates one entry's byte range into `outputPath`, returning the CRC32 and
// byte count of what was written. Nothing is verified here — the caller compares
// against the manifest, so this stays a plain transfer.
async function inflateEntryToFile(installerPath, start, compressedLength, outputPath, onChunk) {
  let digest = 0
  let written = 0

  const source = createReadStream(installerPath, {
    start,
    end: start + compressedLength - 1
  })
  const inflate = createInflateRaw()
  inflate.on('data', (chunk) => {
    digest = crc32(chunk, digest)
    written += chunk.length
    onChunk?.(chunk.length)
  })

  await pipeline(source, inflate, createWriteStream(outputPath))
  return { crc32: digest >>> 0, written }
}

// Extracts `clientFiles` from `installerPath` into `destinationDir`.
//
// `clientFiles` come from readWiseManifest, each carrying a `relativePath` whose
// casing is the installer's own. Nothing here normalises case: on Linux that
// would be the difference between a working tree and one where Legend.dat cannot
// be found. See HTOO-287.
//
// `isAlive` is the liveness check the orphan sweep uses, defaulting to the real
// one. It is an option so a test can stand in a dead pid without depending on
// the OS not having recycled a number in the meantime.
export async function extractClientFiles(
  installerPath,
  { dataBase, clientFiles },
  destinationDir,
  { onProgress, signal, isAlive } = {}
) {
  if (!Array.isArray(clientFiles) || clientFiles.length === 0) {
    throw new ExtractionError('The installer lists no client files', 'no-client-files')
  }
  throwIfCancelled(signal)

  const totalBytes = clientFiles.reduce((sum, file) => sum + file.inflatedSize, 0)
  const staging = stagingDirFor(destinationDir, process.pid)
  await sweepOrphanedStaging(destinationDir, isAlive)
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })

  let bytesDone = 0
  let filesDone = 0
  try {
    for (const file of clientFiles) {
      throwIfCancelled(signal)

      const outputPath = join(staging, file.relativePath)
      await fs.mkdir(dirname(outputPath), { recursive: true })

      const start = dataBase + file.deflateStart
      const compressedLength = file.deflateEnd - file.deflateStart - TRAILING_CRC_SIZE

      let result
      try {
        result = await inflateEntryToFile(
          installerPath,
          start,
          compressedLength,
          outputPath,
          () => {}
        )
      } catch (cause) {
        throw new ExtractionError(
          `Could not unpack ${file.relativePath}: ${cause.message}`,
          'inflate-failed'
        )
      }

      if (result.written !== file.inflatedSize) {
        throw new ExtractionError(
          `${file.relativePath} unpacked to ${result.written} bytes, expected ${file.inflatedSize}`,
          'size-mismatch'
        )
      }
      if (file.crc32 !== 0 && result.crc32 !== file.crc32) {
        throw new ExtractionError(`${file.relativePath} failed its checksum`, 'checksum-mismatch')
      }

      bytesDone += result.written
      filesDone++
      onProgress?.({
        phase: 'extract',
        file: file.relativePath,
        filesDone,
        filesTotal: clientFiles.length,
        bytesDone,
        totalBytes
      })
    }

    await moveIntoPlace(staging, destinationDir)
    return { filesWritten: filesDone, bytesWritten: bytesDone, destinationDir }
  } catch (error) {
    // Isolate the failure: the caller gets an error and the user's chosen folder
    // is left exactly as it was.
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

// Promotes the staging directory to the destination.
//
// The cheap path is a single rename, available when the destination does not
// exist yet. When it does — the user picked a folder that already has something
// in it — entries are moved across individually. Both are same-volume renames,
// because staging is deliberately a sibling of the destination.
async function moveIntoPlace(staging, destinationDir) {
  let existing = null
  try {
    existing = await fs.readdir(destinationDir)
  } catch {
    existing = null
  }

  if (existing === null) {
    await fs.mkdir(dirname(destinationDir), { recursive: true })
    await fs.rename(staging, destinationDir)
    return
  }

  await mergeDirectory(staging, destinationDir)
  await fs.rm(staging, { recursive: true, force: true })
}

async function mergeDirectory(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) {
      await fs.mkdir(target, { recursive: true })
      await mergeDirectory(source, target)
    } else {
      await fs.rm(target, { force: true })
      await fs.rename(source, target)
    }
  }
}
