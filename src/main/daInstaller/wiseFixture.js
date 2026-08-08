// Builds a synthetic Wise installer in memory. TEST SUPPORT ONLY — nothing in
// the app imports this, and it is not part of any bundle.
//
// It exists because the real article is a 208 MB download that cannot go in the
// repository, and because the interesting cases are ones the retail installer
// does not contain: a truncated payload, a file whose CRC32 disagrees with its
// bytes, a destination path trying to escape the tree. Those have to be
// constructed.
//
// What it reproduces, because the reader depends on each of them:
//
//   * a PE stub whose section table implies an overlay offset
//   * a variable-length Wise header before the first deflate stream, so the
//     reader has to find that stream rather than assume where it starts
//   * the stream chain: raw DEFLATE, each followed by its inflated CRC32
//   * the palette bitmap and WiseScript.bin ahead of the file data
//   * deflateStart/deflateEnd measured from the first FILE stream, not from the
//     overlay, with the trailing CRC32 counted inside the span

import { deflateRawSync, crc32 } from 'zlib'

const PE_OFFSET = 0x80
const OPTIONAL_HEADER_SIZE = 224
const SECTION_RAW_POINTER = 0x400
const SECTION_RAW_SIZE = 0x200
// Where the section table says the mapped file ends, and so where overlay begins.
export const FIXTURE_OVERLAY_OFFSET = SECTION_RAW_POINTER + SECTION_RAW_SIZE

// Stands in for the wizard's font name and captions. Any length works; a value
// that is not a multiple of anything is the point, so nothing can pass by
// accidentally assuming alignment.
const WISE_HEADER = Buffer.from('\0\x01\x02FIXTURE Sans Serif\0Dark Ages\0', 'latin1')

function buildStub() {
  const stub = Buffer.alloc(FIXTURE_OVERLAY_OFFSET)
  stub.writeUInt16LE(0x5a4d, 0) // 'MZ'
  stub.writeUInt32LE(PE_OFFSET, 0x3c)
  stub.write('PE', PE_OFFSET, 'latin1')
  stub.writeUInt16LE(0x014c, PE_OFFSET + 4) // i386
  stub.writeUInt16LE(1, PE_OFFSET + 6) // one section
  stub.writeUInt16LE(OPTIONAL_HEADER_SIZE, PE_OFFSET + 20)

  const section = PE_OFFSET + 24 + OPTIONAL_HEADER_SIZE
  stub.write('.text', section, 'latin1')
  stub.writeUInt32LE(SECTION_RAW_SIZE, section + 16)
  stub.writeUInt32LE(SECTION_RAW_POINTER, section + 20)
  return stub
}

// One deflate stream: compressed bytes followed by the CRC32 of the inflated
// bytes, which is the framing the format uses throughout.
function buildStream(contents) {
  const compressed = deflateRawSync(contents)
  const trailer = Buffer.alloc(4)
  trailer.writeUInt32LE(crc32(contents) >>> 0, 0)
  return { bytes: Buffer.concat([compressed, trailer]), compressedLength: compressed.length }
}

// One operation-0x00 record. `crcOverride` lets a test write a checksum that
// disagrees with the data, which is the only way to exercise the rejection path.
function buildFileEntry({ destFile, deflateStart, deflateEnd, inflatedSize, crcOverride }) {
  const destBytes = Buffer.from(destFile, 'latin1')
  const record = Buffer.alloc(43 + destBytes.length + 3)
  record[0] = 0x00 // operation: file
  record.writeUInt16LE(0x8000, 1) // the unknown flag pair, a value seen in the wild
  record.writeUInt32LE(deflateStart, 3)
  record.writeUInt32LE(deflateEnd, 7)
  record.writeUInt16LE(0x2c21, 11) // MS-DOS date
  record.writeUInt16LE(0x7000, 13) // MS-DOS time
  record.writeUInt32LE(inflatedSize, 15)
  record.writeUInt32LE(crcOverride, 39)
  destBytes.copy(record, 43)
  // A NUL for the per-language file text, then the record terminator.
  return record
}

// Assembles an installer.
//
// `files` is [{ destFile, contents, crcOverride? }]. Returns the buffer plus the
// offsets a test may want to assert against or corrupt.
export function buildWiseInstaller(files, { scriptPrelude } = {}) {
  const stub = buildStub()

  // A plausible script header. Its content does not matter to the reader — it
  // scans past it — but it must be long enough that entry records are not the
  // first thing in the file, and it must contain zero bytes, because runs of them
  // are what generate the false-positive candidates worth exercising.
  const prelude = scriptPrelude ?? Buffer.alloc(96)

  // Lay the file streams out first, so entry records can carry real offsets.
  const streams = []
  const entries = []
  let cursor = 0
  for (const file of files) {
    const stream = buildStream(file.contents)
    entries.push({
      destFile: file.destFile,
      deflateStart: cursor,
      deflateEnd: cursor + stream.bytes.length,
      inflatedSize: file.contents.length,
      crcOverride: file.crcOverride ?? crc32(file.contents) >>> 0
    })
    streams.push(stream.bytes)
    cursor += stream.bytes.length
  }

  const script = Buffer.concat([prelude, ...entries.map(buildFileEntry)])
  const colorsStream = buildStream(Buffer.from('fixture palette bitmap', 'latin1'))
  const scriptStream = buildStream(script)

  const overlay = Buffer.concat([WISE_HEADER, colorsStream.bytes, scriptStream.bytes, ...streams])
  const dataBaseInOverlay =
    WISE_HEADER.length + colorsStream.bytes.length + scriptStream.bytes.length

  return {
    buffer: Buffer.concat([stub, overlay]),
    overlayOffset: FIXTURE_OVERLAY_OFFSET,
    // Absolute file offset, matching what readWiseManifest reports.
    dataBase: FIXTURE_OVERLAY_OFFSET + dataBaseInOverlay,
    entries
  }
}
