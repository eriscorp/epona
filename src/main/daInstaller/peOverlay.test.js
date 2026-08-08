import { describe, it, expect } from 'vitest'
import { findOverlayOffset, NotAPortableExecutableError } from './peOverlay.js'
import { buildWiseInstaller, FIXTURE_OVERLAY_OFFSET } from './wiseFixture.js'

function stubOf() {
  return buildWiseInstaller([{ destFile: '%MAINDIR%\\a.dat', contents: Buffer.from('a') }]).buffer
}

describe('findOverlayOffset', () => {
  it('puts the overlay one past the end of the last section', () => {
    expect(findOverlayOffset(stubOf())).toBe(FIXTURE_OVERLAY_OFFSET)
  })

  it('works from the headers alone, without the rest of the file', () => {
    // The caller reads a fixed-size head off the front rather than the whole
    // 208 MB installer, so the answer must not depend on the buffer reaching it.
    const head = stubOf().subarray(0, 2048)
    expect(findOverlayOffset(head)).toBe(FIXTURE_OVERLAY_OFFSET)
    expect(FIXTURE_OVERLAY_OFFSET).toBeLessThanOrEqual(head.length)
  })

  it('rejects a file with no MZ signature', () => {
    const notExe = Buffer.alloc(4096, 0x41)
    expect(() => findOverlayOffset(notExe)).toThrow(NotAPortableExecutableError)
  })

  it('rejects a buffer too short to hold a DOS header', () => {
    expect(() => findOverlayOffset(Buffer.alloc(8))).toThrow(/too short/)
  })

  it('rejects a DOS executable with no PE header', () => {
    const dosOnly = Buffer.alloc(4096)
    dosOnly.writeUInt16LE(0x5a4d, 0)
    dosOnly.writeUInt32LE(0x80, 0x3c) // points at zeroes, not 'PE'
    expect(() => findOverlayOffset(dosOnly)).toThrow(/PE signature/)
  })

  it('rejects an implausible section count rather than looping over it', () => {
    const buffer = stubOf()
    const peOffset = buffer.readUInt32LE(0x3c)
    buffer.writeUInt16LE(4096, peOffset + 6)
    expect(() => findOverlayOffset(buffer)).toThrow(/section count/)
  })

  it('carries a reason a caller can branch on', () => {
    try {
      findOverlayOffset(Buffer.alloc(4096, 0x41))
      throw new Error('should have thrown')
    } catch (error) {
      expect(error.reason).toBe('not-an-executable')
    }
  })
})
