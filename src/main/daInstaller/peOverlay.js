// Where does a Wise installer's payload start?
//
// A Wise installer is an ordinary PE executable — a small stub that knows how to
// unpack itself — with the real payload appended after the last section. Nothing
// in the PE headers points at that payload; you find it by working out where the
// mapped file legitimately ends and treating the remainder as overlay.
//
// Pure buffer arithmetic on purpose: it takes the first few KB of the file and
// nothing else, so it is testable without a 208 MB fixture on disk.

const MZ_SIGNATURE = 0x5a4d // 'MZ'
const PE_OFFSET_AT = 0x3c
const COFF_HEADER_SIZE = 24
const SECTION_ENTRY_SIZE = 40
const SECTION_RAW_SIZE_AT = 16
const SECTION_RAW_PTR_AT = 20

// Guards against a corrupt or hostile header steering us into a huge loop. Real
// PE files run to a handful of sections; the format's own field is 16-bit.
const MAX_SECTIONS = 96

export class NotAPortableExecutableError extends Error {
  constructor(detail) {
    super(`Not a Windows executable: ${detail}`)
    this.name = 'NotAPortableExecutableError'
    this.reason = 'not-an-executable'
  }
}

// Returns the file offset at which overlay data begins — i.e. one past the end
// of the last section's raw data. For the Dark Ages installer this is 0x3a00,
// which matches the overlay offsets REWise records for Wise stubs built between
// 1999 and 2001.
//
// `head` only has to be long enough to hold the headers and the section table.
// It does NOT have to be the whole file, and the returned offset will usually
// lie beyond it.
export function findOverlayOffset(head) {
  if (!Buffer.isBuffer(head) || head.length < 64) {
    throw new NotAPortableExecutableError('file is too short to hold a DOS header')
  }
  if (head.readUInt16LE(0) !== MZ_SIGNATURE) {
    throw new NotAPortableExecutableError('missing MZ signature')
  }

  const peOffset = head.readUInt32LE(PE_OFFSET_AT)
  if (peOffset + COFF_HEADER_SIZE > head.length) {
    throw new NotAPortableExecutableError('PE header lies outside the supplied buffer')
  }
  if (head.toString('latin1', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new NotAPortableExecutableError('missing PE signature')
  }

  const sectionCount = head.readUInt16LE(peOffset + 6)
  const optionalHeaderSize = head.readUInt16LE(peOffset + 20)
  if (sectionCount === 0 || sectionCount > MAX_SECTIONS) {
    throw new NotAPortableExecutableError(`implausible section count ${sectionCount}`)
  }

  const tableStart = peOffset + COFF_HEADER_SIZE + optionalHeaderSize
  const tableEnd = tableStart + sectionCount * SECTION_ENTRY_SIZE
  if (tableEnd > head.length) {
    throw new NotAPortableExecutableError('section table lies outside the supplied buffer')
  }

  let overlayOffset = 0
  for (let i = 0; i < sectionCount; i++) {
    const entry = tableStart + i * SECTION_ENTRY_SIZE
    const rawPointer = entry + SECTION_RAW_PTR_AT
    const rawPointerValue = head.readUInt32LE(rawPointer)
    // A zero raw pointer means the section has no file backing (.bss and
    // friends). Including it would drag the overlay offset down to 0.
    if (rawPointerValue === 0) continue
    const end = rawPointerValue + head.readUInt32LE(entry + SECTION_RAW_SIZE_AT)
    if (end > overlayOffset) overlayOffset = end
  }

  if (overlayOffset === 0) {
    throw new NotAPortableExecutableError('no section carries file data')
  }
  return overlayOffset
}
