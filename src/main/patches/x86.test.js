import { describe, it, expect } from 'vitest'
import { buildCall, buildJump, buildStub, parseHex, patchRel32, rel32, writeU32 } from './x86.js'

describe('rel32', () => {
  it('is measured from the end of the instruction, not its start', () => {
    // jmp at 0x1000 (5 bytes) to 0x2000 → 0x2000 - 0x1005.
    expect(rel32(0x1005n, 0x2000n)).toBe(0xffb)
  })

  it('encodes a backward jump as two’s complement', () => {
    expect(rel32(0x2000n, 0x1000n)).toBe(0xfffff000)
  })

  it('accepts the exact signed-32 bounds', () => {
    expect(rel32(0n, 0x7fffffffn)).toBe(0x7fffffff)
    expect(rel32(0x80000000n, 0n)).toBe(0x80000000)
  })

  it('refuses a displacement that cannot be expressed', () => {
    // A 32-bit target can always be reached from a 32-bit source, but the
    // guard has to hold for the arithmetic itself.
    expect(() => rel32(0n, 0x80000000n)).toThrow(/does not fit/)
  })

  it('refuses a non-BigInt or out-of-range address', () => {
    expect(() => rel32(0x1000, 0x2000n)).toThrow(/BigInt/)
    expect(() => rel32(0n, 0x1_0000_0000n)).toThrow(/32 bits/)
  })
})

describe('buildJump', () => {
  it('emits E9 + rel32', () => {
    expect([...buildJump(0x00467c10n, 0x01000000n)]).toEqual([0xe9, 0xeb, 0x83, 0xb9, 0x00])
  })

  it('NOP-pads a wider displacement so no half instruction survives', () => {
    // The frame hook displaces six bytes; the sixth must be a NOP, not the
    // leftover tail of `sub esp, 0x1C`.
    const jump = buildJump(0x005ce280n, 0x01000000n, 6)
    expect(jump.length).toBe(6)
    expect(jump[5]).toBe(0x90)
    // The displacement still measures from the end of the 5-byte jump.
    expect(jump.readUInt32LE(1)).toBe(rel32(0x005ce285n, 0x01000000n))
  })

  it('refuses to emit a jump that would not fit', () => {
    expect(() => buildJump(0n, 0n, 4)).toThrow(/at least 5 bytes/)
  })
})

describe('buildCall', () => {
  it('emits E8 + rel32', () => {
    // The real stuck-modifier site: 0x004A9D81 calls 0x004AC950.
    const call = buildCall(0x004a9d81n, 0x004ac950n)
    expect([...call]).toEqual([0xe8, 0xca, 0x2b, 0x00, 0x00])
  })
})

describe('writeU32', () => {
  it('writes little-endian', () => {
    const buf = Buffer.alloc(4)
    writeU32(buf, 0, 0x11223344n)
    expect([...buf]).toEqual([0x44, 0x33, 0x22, 0x11])
  })

  it('refuses to write past the end of the buffer', () => {
    expect(() => writeU32(Buffer.alloc(4), 1, 0n)).toThrow(/outside/)
    expect(() => writeU32(Buffer.alloc(4), -1, 0n)).toThrow(/outside/)
  })
})

describe('patchRel32', () => {
  it('measures from the byte after the operand', () => {
    // E8 at offset 0 → operand at 1 → next instruction at base+5.
    const buf = Buffer.from([0xe8, 0, 0, 0, 0])
    patchRel32(buf, 0x1000n, 1, 0x2000n)
    expect(buf.readUInt32LE(1)).toBe(rel32(0x1005n, 0x2000n))
  })
})

describe('parseHex', () => {
  it('ignores whitespace and // comments', () => {
    expect([...parseHex('55 89E5 // push ebp; mov ebp,esp\n 5D')]).toEqual([0x55, 0x89, 0xe5, 0x5d])
  })

  it('rejects malformed templates instead of guessing', () => {
    expect(() => parseHex('55 8')).toThrow(/odd number/)
    expect(() => parseHex('55 ZZ')).toThrow(/non-hex/)
  })
})

describe('buildStub', () => {
  const template = 'B8 11 11 11 11 E8 00 00 00 00 C3'

  it('applies absolute and relative relocations', () => {
    const stub = buildStub(template, 0x1000n, [
      { offset: 1, kind: 'abs', target: 0xdeadbeefn },
      { offset: 6, kind: 'rel', target: 0x2000n }
    ])
    expect(stub.readUInt32LE(1)).toBe(0xdeadbeef)
    // The call's next instruction is at 0x1000 + 6 + 4 = 0x100A.
    expect(stub.readUInt32LE(6)).toBe(rel32(0x100an, 0x2000n))
    expect(stub[10]).toBe(0xc3)
  })

  it('refuses a relocation that runs off the end', () => {
    expect(() => buildStub(template, 0x1000n, [{ offset: 9, kind: 'abs', target: 0n }])).toThrow(
      /outside/
    )
  })

  it('refuses an unknown relocation kind', () => {
    expect(() => buildStub(template, 0x1000n, [{ offset: 1, kind: 'wat', target: 0n }])).toThrow(
      /unknown relocation kind/
    )
  })
})
