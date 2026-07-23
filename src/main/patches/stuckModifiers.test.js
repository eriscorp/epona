import { describe, it, expect } from 'vitest'
import { buildModifierCleanupStub, STUB_SIZE, templateLength } from './stuckModifiers.js'
import { buildCall, rel32 } from './x86.js'
import { HELPERS, HOOKS } from './sites741.js'

const MODULE = 0x00400000n
const STUB_BASE = 0x03000000n
const stub = buildModifierCleanupStub({ moduleBase: MODULE, stubBase: STUB_BASE })

const shortJumpTarget = (buf, offset) => offset + 2 + buf.readInt8(offset + 1)

describe('modifier cleanup stub', () => {
  it('is the 68 bytes the appendix allocates', () => {
    expect(templateLength()).toBe(STUB_SIZE)
    expect(stub.length).toBe(STUB_SIZE)
  })

  it('preserves the caller’s flags and registers around the scan', () => {
    expect(stub[0x00]).toBe(0x9c) // pushfd
    expect(stub[0x01]).toBe(0x60) // pushad
    expect(stub[0x3d]).toBe(0x61) // popad
    expect(stub[0x3e]).toBe(0x9d) // popfd
  })

  it('treats a missing EventMan as safe rather than dereferencing it', () => {
    expect(shortJumpTarget(stub, 0x09)).toBe(0x3d) // je cleanup_done (past the scan)
  })

  it('walks the whole 256-entry key array', () => {
    // test byte [ebx+esi+0x334], 0x80 — the pressed-key array and its high bit.
    expect([...stub.subarray(0x16, 0x1e)]).toEqual([0xf6, 0x84, 0x33, 0x34, 0x03, 0x00, 0x00, 0x80])
    expect([...stub.subarray(0x2e, 0x34)]).toEqual([0x81, 0xfe, 0x00, 0x01, 0x00, 0x00]) // cmp esi,256
    expect(shortJumpTarget(stub, 0x34)).toBe(0x16) // jl scan_loop
    expect(shortJumpTarget(stub, 0x1e)).toBe(0x2d) // not pressed → next_scan
  })

  it('clears the cached modifier mask after the scan', () => {
    // mov byte [ebx+0x434], 0 — the same field the ground-item hint reads, which
    // is why a lost Alt key-up would otherwise strand the overlay on.
    expect([...stub.subarray(0x36, 0x3d)]).toEqual([0xc6, 0x83, 0x34, 0x04, 0x00, 0x00, 0x00])
  })

  it('posts key-ups through the client’s own input path', () => {
    expect(stub.readUInt32LE(0x29)).toBe(rel32(STUB_BASE + 0x2dn, MODULE + HELPERS.inputPostKeyUp))
  })

  it('resolves all four documented relocations', () => {
    // Straight from the appendix's displacement table.
    expect(stub.readUInt32LE(0x03)).toBe(
      rel32(STUB_BASE + 0x07n, MODULE + HELPERS.inputGetEventManager)
    )
    expect(stub.readUInt32LE(0x0e)).toBe(
      rel32(STUB_BASE + 0x12n, MODULE + HELPERS.getMessageTimeThunk)
    )
    expect(stub.readUInt32LE(0x29)).toBe(rel32(STUB_BASE + 0x2dn, MODULE + HELPERS.inputPostKeyUp))
    expect(stub.readUInt32LE(0x40)).toBe(
      rel32(STUB_BASE + 0x44n, MODULE + HELPERS.originalActivationState)
    )
  })

  it('ends by entering the original activation-state function', () => {
    // A jmp, not a call: it returns through the return address the replacement
    // CALL at the hook site created.
    expect(stub[0x3f]).toBe(0xe9)
  })

  it('leaves no zeroed relocation behind', () => {
    for (const offset of [0x03, 0x0e, 0x29, 0x40]) {
      expect(stub.readUInt32LE(offset)).not.toBe(0)
    }
  })
})

describe('the replacement call at the hook site', () => {
  it('redirects the inactive-focus call to the stub', () => {
    const site = MODULE + HOOKS.activateInactive.rva
    const call = buildCall(site, STUB_BASE)
    expect(call[0]).toBe(0xe8)
    expect(call.length).toBe(HOOKS.activateInactive.displaced.length)
    expect(call.readUInt32LE(1)).toBe(
      rel32(MODULE + HOOKS.activateInactive.continuation, STUB_BASE)
    )
  })
})
