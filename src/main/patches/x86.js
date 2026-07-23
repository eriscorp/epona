// Small x86 encoding helpers shared by the runtime-patch stub builders.
//
// Everything here is pure and works on plain Buffers/BigInts, so the byte
// templates in src/main/patches/*.js can be asserted byte-for-byte in tests —
// which is the only practical way to be confident about machine code we never
// get to single-step.
//
// Addresses are BigInt throughout (matching clientVersions.js and the da-win32
// bridge). The target is 32-bit, so every address must fit in 32 bits.

export const JMP_REL32 = 0xe9
export const CALL_REL32 = 0xe8
export const NOP = 0x90

// Fail loudly rather than silently truncating — a wrong address here writes
// machine code into a live process.
export function assertUint32(value, what) {
  if (typeof value !== 'bigint') throw new Error(`${what}: expected a BigInt address`)
  if (value < 0n || value > 0xffffffffn)
    throw new Error(`${what}: ${value} does not fit in 32 bits`)
  return value
}

// The rel32 operand for a jump/call: how far to travel from the END of the
// instruction (`nextInstruction`) to reach `target`. Signed, so a backward jump
// is negative; rejected if it can't be expressed in 32 bits.
export function rel32(nextInstruction, target) {
  assertUint32(nextInstruction, 'rel32 source')
  assertUint32(target, 'rel32 target')
  const delta = BigInt.asIntN(64, target - nextInstruction)
  if (delta < -0x80000000n || delta > 0x7fffffffn) {
    throw new Error(`rel32 displacement ${delta} does not fit in a signed 32-bit operand`)
  }
  return Number(BigInt.asUintN(32, delta))
}

// Write a little-endian u32 at `offset`. Accepts BigInt (an address) or Number
// (an already-computed displacement).
export function writeU32(buf, offset, value) {
  if (offset < 0 || offset + 4 > buf.length) {
    throw new Error(`writeU32: offset ${offset} is outside a ${buf.length}-byte buffer`)
  }
  const v = typeof value === 'bigint' ? assertUint32(value, 'writeU32 value') : BigInt(value >>> 0)
  buf.writeUInt32LE(Number(BigInt.asUintN(32, v)), offset)
  return buf
}

// Patch a rel32 operand in place. `operandOffset` is where the 4-byte
// displacement starts; the instruction is assumed to end 4 bytes later.
export function patchRel32(buf, base, operandOffset, target) {
  const nextInstruction = base + BigInt(operandOffset + 4)
  return writeU32(buf, operandOffset, rel32(nextInstruction, target))
}

// `jmp rel32` from `at` to `target`, padded to `width` bytes with NOPs.
// Used to overwrite a function prologue: the displaced instructions must be
// replaced whole, so a 6-byte prologue gets a 5-byte jump plus one NOP.
export function buildJump(at, target, width = 5) {
  if (width < 5) throw new Error(`buildJump: need at least 5 bytes, got ${width}`)
  const buf = Buffer.alloc(width, NOP)
  buf[0] = JMP_REL32
  writeU32(buf, 1, rel32(at + 5n, target))
  return buf
}

// `call rel32` from `at` to `target`. Replaces an existing 5-byte call, so no
// padding case exists.
export function buildCall(at, target) {
  const buf = Buffer.alloc(5)
  buf[0] = CALL_REL32
  writeU32(buf, 1, rel32(at + 5n, target))
  return buf
}

// Build a stub from a hex template plus a relocation list. The template carries
// placeholder operands (the appendix listings show them as recognisable junk
// like 11 11 11 11); every one must be named here, so a forgotten relocation is
// a missing-key error rather than a jump into nowhere.
//
//   template     — hex string, whitespace and // comments ignored
//   base         — where the stub will live in the target
//   relocations  — [{ offset, kind: 'abs' | 'rel', target }]
//                  'abs' writes the address itself (an operand like [state.count]);
//                  'rel' writes the rel32 to reach it from the next instruction.
export function buildStub(template, base, relocations) {
  const buf = parseHex(template)
  assertUint32(base, 'stub base')
  for (const { offset, kind, target } of relocations) {
    if (offset + 4 > buf.length) {
      throw new Error(`relocation at ${offset} is outside the ${buf.length}-byte stub`)
    }
    if (kind === 'abs') writeU32(buf, offset, target)
    else if (kind === 'rel') patchRel32(buf, base, offset, target)
    else throw new Error(`unknown relocation kind: ${kind}`)
  }
  return buf
}

// Hex template → Buffer. Strips `//` comments and all whitespace so the
// templates can be laid out to match the appendix listings line for line.
export function parseHex(template) {
  const cleaned = String(template)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\s+/g, '')
  if (cleaned.length % 2 !== 0) throw new Error('hex template has an odd number of nibbles')
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) throw new Error('hex template has non-hex characters')
  return Buffer.from(cleaned, 'hex')
}
