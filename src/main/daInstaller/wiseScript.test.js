import { describe, it, expect } from 'vitest'
import {
  findFileEntryCandidates,
  splitDestPath,
  isClientFileEntry,
  clientRelativePath
} from './wiseScript.js'

// A minimal operation-0x00 record, so candidate scanning can be exercised without
// building a whole installer.
function record({ destFile, deflateStart = 0, deflateEnd = 100, inflatedSize = 10, crc32 = 7 }) {
  const dest = Buffer.from(destFile, 'latin1')
  const buffer = Buffer.alloc(43 + dest.length + 2)
  buffer[0] = 0x00
  buffer.writeUInt32LE(deflateStart, 3)
  buffer.writeUInt32LE(deflateEnd, 7)
  buffer.writeUInt32LE(inflatedSize, 15)
  buffer.writeUInt32LE(crc32, 39)
  dest.copy(buffer, 43)
  return buffer
}

describe('findFileEntryCandidates', () => {
  it('reads the fields of a file record', () => {
    const script = record({
      destFile: '%MAINDIR%\\Legend.dat',
      deflateStart: 40,
      deflateEnd: 140,
      inflatedSize: 1234,
      crc32: 0xdeadbeef
    })
    const [entry] = findFileEntryCandidates(script, 1000)
    expect(entry).toMatchObject({
      deflateStart: 40,
      deflateEnd: 140,
      inflatedSize: 1234,
      crc32: 0xdeadbeef,
      destFile: '%MAINDIR%\\Legend.dat'
    })
  })

  it('rejects a span too small to hold its own trailing checksum', () => {
    const script = record({ destFile: '%MAINDIR%\\a.dat', deflateStart: 10, deflateEnd: 13 })
    expect(findFileEntryCandidates(script, 1000)).toEqual([])
  })

  it('rejects a span that runs past the available payload', () => {
    const script = record({ destFile: '%MAINDIR%\\a.dat', deflateStart: 0, deflateEnd: 5000 })
    expect(findFileEntryCandidates(script, 1000)).toEqual([])
  })

  it('rejects a zero-length entry, which cannot be told from script padding', () => {
    const script = record({ destFile: '%MAINDIR%\\usa.nfo', inflatedSize: 0 })
    expect(findFileEntryCandidates(script, 1000)).toEqual([])
  })

  it('rejects a destination that is not printable ASCII', () => {
    const script = record({ destFile: '%MAINDIR%\\\u0007bell.dat' })
    expect(findFileEntryCandidates(script, 1000)).toEqual([])
  })

  it('returns nothing for a buffer of padding, without throwing', () => {
    expect(findFileEntryCandidates(Buffer.alloc(512), 1000)).toEqual([])
  })

  it('tolerates a non-buffer instead of crashing the manifest read', () => {
    expect(findFileEntryCandidates(null, 1000)).toEqual([])
  })
})

describe('splitDestPath', () => {
  it('separates the Wise root variable from the rest', () => {
    expect(splitDestPath('%MAINDIR%\\npc\\npcbase.dat')).toEqual({
      variable: '%MAINDIR%',
      rest: 'npc\\npcbase.dat'
    })
  })

  it('reports a bare variable as having no remainder', () => {
    expect(splitDestPath('%UNINSTALL_PATH%')).toEqual({ variable: '%UNINSTALL_PATH%', rest: null })
  })

  it('reports no variable when the path does not start with one', () => {
    expect(splitDestPath('C:\\Program Files\\x.dat').variable).toBeNull()
  })
})

describe('isClientFileEntry', () => {
  const accepts = (destFile) => isClientFileEntry({ destFile })

  it('accepts a file under the install directory', () => {
    expect(accepts('%MAINDIR%\\Legend.dat')).toBe(true)
    expect(accepts('%MAINDIR%\\npc\\npcbase.dat')).toBe(true)
  })

  it("rejects the installer's own scratch and uninstall entries", () => {
    // These are real entries in the retail installer. %TEMP% names are themselves
    // unexpanded variables, so there is no filename to write even if we wanted to.
    expect(accepts('%TEMP%\\%W32INST_PATH_%')).toBe(false)
    expect(accepts('%TEMP%\\%READMEFILE%')).toBe(false)
    expect(accepts('%UNINSTALL_PATH%')).toBe(false)
  })

  it('rejects a remainder still holding an unexpanded variable', () => {
    expect(accepts('%MAINDIR%\\%SOMETHING%.dat')).toBe(false)
  })

  it('refuses to let a path escape the destination directory', () => {
    expect(accepts('%MAINDIR%\\..\\..\\evil.dat')).toBe(false)
    expect(accepts('%MAINDIR%\\.\\a.dat')).toBe(false)
    expect(accepts('%MAINDIR%\\C:\\evil.dat')).toBe(false)
  })

  it('rejects an entry with nothing after the variable', () => {
    expect(accepts('%MAINDIR%')).toBe(false)
    expect(accepts('%MAINDIR%\\')).toBe(false)
  })
})

describe('clientRelativePath', () => {
  it('keeps the casing the installer supplied', () => {
    // The whole feature exists for Linux, where this is the difference between a
    // working tree and one where the client cannot find its archives. HTOO-287.
    expect(clientRelativePath({ destFile: '%MAINDIR%\\Legend.dat' })).toBe('Legend.dat')
    expect(clientRelativePath({ destFile: '%MAINDIR%\\Darkages.exe' })).toBe('Darkages.exe')
    expect(clientRelativePath({ destFile: '%MAINDIR%\\DA-DisplaySelector.exe' })).toBe(
      'DA-DisplaySelector.exe'
    )
  })

  it('never lowercases, even for a name that is already lowercase elsewhere', () => {
    const path = clientRelativePath({ destFile: '%MAINDIR%\\SETOA.DAT' })
    expect(path).toBe('SETOA.DAT')
    expect(path).not.toBe('setoa.dat')
  })

  it('turns Windows separators into POSIX ones without touching the names', () => {
    expect(clientRelativePath({ destFile: '%MAINDIR%\\npc\\NpcBase.dat' })).toBe('npc/NpcBase.dat')
  })
})
