import { describe, it, expect } from 'vitest'
import {
  buildCollectorStub,
  buildFrameStub,
  buildKeyStub,
  STUB_SIZES,
  TEMPLATES,
  templateLengths
} from './groundItemHints.js'
import { parseHex, rel32 } from './x86.js'
import { HELPERS, HOOKS, STATE } from './sites741.js'

// Machine code we can never single-step, so it gets asserted instead: the
// templates keep the appendix's documented lengths, every internal jump lands on
// a real label, every relocation matches the documented formula, and nothing
// keeps a placeholder.

const MODULE = 0x00400000n
const STATE_BASE = 0x02000000n
const STUB_BASE = 0x03000000n
const args = { moduleBase: MODULE, stateBase: STATE_BASE, stubBase: STUB_BASE }

// Follow a short (rel8) jump at `offset` and report where it lands.
const shortJumpTarget = (buf, offset) => offset + 2 + buf.readInt8(offset + 1)
// Follow a near (rel32) call/jump within the stub.
const nearTarget = (buf, offset) => offset + 5 + buf.readInt32LE(offset + 1)

describe('stub sizes match the appendix', () => {
  it('collector 157, frame 186, key 84', () => {
    const lengths = templateLengths()
    expect(lengths.collector).toBe(STUB_SIZES.collector)
    expect(lengths.frame).toBe(STUB_SIZES.frame)
    expect(lengths.key).toBe(STUB_SIZES.keyDown)
    expect(lengths.key).toBe(STUB_SIZES.keyUp)
  })

  it('relocation never changes a stub’s length', () => {
    expect(buildCollectorStub(args).length).toBe(STUB_SIZES.collector)
    expect(buildFrameStub(args).length).toBe(STUB_SIZES.frame)
    expect(buildKeyStub({ ...args, hook: HOOKS.keyDown }).length).toBe(STUB_SIZES.keyDown)
  })
})

describe('collector stub', () => {
  const stub = buildCollectorStub(args)

  it('replays the displaced prologue before returning to the client', () => {
    // The local gateway at 0x93 must reproduce exactly the bytes the jump
    // overwrote, or the original function starts mid-frame-setup.
    expect([...stub.subarray(0x93, 0x96)]).toEqual([0x55, 0x89, 0xe5]) // push ebp; mov ebp,esp
    expect([...stub.subarray(0x96, 0x98)]).toEqual([0x6a, 0xff]) // push -1
    expect(stub[0x98]).toBe(0xe9)
  })

  it('calls its own gateway, not the hooked address', () => {
    expect(nearTarget(stub, 0x1c)).toBe(0x93)
  })

  it('jumps back to the client just past the displaced bytes', () => {
    const nextInstruction = STUB_BASE + 0x9dn
    expect(stub.readUInt32LE(0x99)).toBe(
      rel32(nextInstruction, MODULE + HOOKS.collector.continuation)
    )
  })

  it('routes every scan-loop branch to a real label', () => {
    expect(shortJumpTarget(stub, 0x30)).toBe(0x87) // jae collector_done
    expect(shortJumpTarget(stub, 0x36)).toBe(0x82) // je  next_record
    expect(shortJumpTarget(stub, 0x3e)).toBe(0x82) // jne next_record
    expect(shortJumpTarget(stub, 0x47)).toBe(0x82) // jne next_record
    expect(shortJumpTarget(stub, 0x53)).toBe(0x87) // jae collector_done
    expect(shortJumpTarget(stub, 0x85)).toBe(0x2a) // jmp scan_records
  })

  it('checks the item vtable and the ordinary blend mode before copying', () => {
    expect(stub.readUInt32LE(0x3a)).toBe(Number(MODULE + HELPERS.itemVtable))
    // cmp dword [edx+0xB0], 1
    expect([...stub.subarray(0x40, 0x47)]).toEqual([0x83, 0xba, 0xb0, 0x00, 0x00, 0x00, 0x01])
  })

  it('caps the capture at the 255 entries the state block holds', () => {
    // cmp eax, 255 — the bound that keeps a damaged queue from running past
    // the end of launcher memory.
    expect([...stub.subarray(0x4e, 0x53)]).toEqual([0x3d, 0xff, 0x00, 0x00, 0x00])
    expect(STATE.maxEntries).toBe(255)
  })

  it('points every state operand at the right field', () => {
    expect(stub.readUInt32LE(0x4a)).toBe(Number(STATE_BASE + BigInt(STATE.count)))
    expect(stub.readUInt32LE(0x5a)).toBe(Number(STATE_BASE + BigInt(STATE.entries)))
    expect(stub.readUInt32LE(0x70)).toBe(Number(STATE_BASE + BigInt(STATE.count)))
    expect(stub.readUInt32LE(0x76)).toBe(Number(STATE_BASE + BigInt(STATE.renderContext)))
    expect(stub.readUInt32LE(0x7e)).toBe(Number(STATE_BASE + BigInt(STATE.canvas)))
  })

  it('preserves the original stack cleanup', () => {
    expect([...stub.subarray(0x90, 0x93)]).toEqual([0xc2, 0x14, 0x00]) // ret 0x14
  })
})

describe('frame replay stub', () => {
  const stub = buildFrameStub(args)

  it('replays the six-byte displaced prologue', () => {
    expect([...stub.subarray(0xaf, 0xb5)]).toEqual([0x55, 0x89, 0xe5, 0x83, 0xec, 0x1c])
    expect(stub[0xb5]).toBe(0xe9)
  })

  it('draws the normal frame before replaying anything', () => {
    // The call to the gateway (0xAF) precedes every replay instruction.
    expect(nearTarget(stub, 0x1d)).toBe(0xaf)
    expect(0x1d).toBeLessThan(0x39) // replay_loop
  })

  it('gates the replay on the live Alt modifier bit', () => {
    // test byte [eax+0x434], 1 — EventMan's modifier mask, bit 0 = either Alt.
    expect([...stub.subarray(0x2e, 0x35)]).toEqual([0xf6, 0x80, 0x34, 0x04, 0x00, 0x00, 0x01])
    expect(shortJumpTarget(stub, 0x2c)).toBe(0xa5) // no EventMan  → replay_done
    expect(shortJumpTarget(stub, 0x35)).toBe(0xa5) // Alt not down → replay_done
  })

  it('revalidates each entry before drawing it', () => {
    expect(shortJumpTarget(stub, 0x4e)).toBe(0xa2) // null object   → next_replay
    expect(shortJumpTarget(stub, 0x56)).toBe(0xa2) // wrong vtable  → next_replay
    expect(shortJumpTarget(stub, 0x5f)).toBe(0xa2) // wrong blend   → next_replay
    expect(stub.readUInt32LE(0x52)).toBe(Number(MODULE + HELPERS.itemVtable))
  })

  it('sets blend mode 3 and restores the original immediately after the draw', () => {
    // mov dword [edx+0xB0], 3
    expect([...stub.subarray(0x6d, 0x77)]).toEqual([
      0xc7, 0x82, 0xb0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00
    ])
    // mov [edx+0xB0], eax — the restore, after the render call at 0x91.
    expect([...stub.subarray(0x9c, 0xa2)]).toEqual([0x89, 0x82, 0xb0, 0x00, 0x00, 0x00])
  })

  it('calls the client’s own helpers', () => {
    expect(stub.readUInt32LE(0x26)).toBe(
      rel32(STUB_BASE + 0x2an, MODULE + HELPERS.inputGetEventManager)
    )
    expect(stub.readUInt32LE(0x92)).toBe(
      rel32(STUB_BASE + 0x96n, MODULE + HELPERS.renderWorldObject)
    )
  })

  it('loops and returns through real labels', () => {
    expect(shortJumpTarget(stub, 0x3f)).toBe(0xa5) // count exhausted → replay_done
    expect(shortJumpTarget(stub, 0xa3)).toBe(0x39) // jmp replay_loop
    expect(stub[0xae]).toBe(0xc3) // ret, no stack args
  })

  it('resets the capture count at the top of every frame', () => {
    expect([...stub.subarray(0x11, 0x13)]).toEqual([0xc7, 0x05])
    expect(stub.readUInt32LE(0x13)).toBe(Number(STATE_BASE + BigInt(STATE.count)))
    expect(stub.readUInt32LE(0x17)).toBe(0)
  })

  it('saves the live world pane for the key hooks', () => {
    expect(stub.readUInt32LE(0x0d)).toBe(Number(STATE_BASE + BigInt(STATE.worldPane)))
  })
})

describe('Alt key stub', () => {
  const down = buildKeyStub({ ...args, hook: HOOKS.keyDown })
  const up = buildKeyStub({ ...args, hook: HOOKS.keyUp })

  it('matches both Alt scan codes', () => {
    expect([...down.subarray(0x1f, 0x23)]).toEqual([0x0f, 0xb6, 0x45, 0x08]) // movzx from arg 1
    expect([...down.subarray(0x23, 0x26)]).toEqual([0x83, 0xf8, 0x38]) // cmp eax, 0x38 (left)
    expect([...down.subarray(0x28, 0x2d)]).toEqual([0x3d, 0xb8, 0x00, 0x00, 0x00]) // 0xB8 (right)
    expect(shortJumpTarget(down, 0x26)).toBe(0x2f) // left Alt  → invalidate
    expect(shortJumpTarget(down, 0x2d)).toBe(0x40) // anything else → key_done
  })

  it('skips invalidation before the first frame has saved a pane', () => {
    expect(down.readUInt32LE(0x31)).toBe(Number(STATE_BASE + BigInt(STATE.worldPane)))
    expect(shortJumpTarget(down, 0x37)).toBe(0x40) // null pane → key_done
  })

  it('invalidates through the client’s own pane call', () => {
    expect(down[0x39]).toBe(0x6a) // push 0 — no dirty rectangle
    expect(down.readUInt32LE(0x3c)).toBe(
      rel32(STUB_BASE + 0x40n, MODULE + HELPERS.uiPaneInvalidate)
    )
  })

  it('runs the original handler first and preserves its result', () => {
    expect(nearTarget(down, 0x17)).toBe(0x4a) // the local gateway
    expect([...down.subarray(0x1c, 0x1f)]).toEqual([0x89, 0x45, 0xfc]) // mov [ebp-4], eax
    expect([...down.subarray(0x40, 0x43)]).toEqual([0x8b, 0x45, 0xfc]) // mov eax, [ebp-4]
    expect([...down.subarray(0x47, 0x4a)]).toEqual([0xc2, 0x10, 0x00]) // ret 0x10
  })

  it('differs between down and up only in the continuation', () => {
    // Same template, two hook sites: every byte outside the final rel32 matches.
    expect(down.subarray(0, 0x50).equals(up.subarray(0, 0x50))).toBe(true)
    expect(down.readUInt32LE(0x50)).toBe(
      rel32(STUB_BASE + 0x54n, MODULE + HOOKS.keyDown.continuation)
    )
    expect(up.readUInt32LE(0x50)).toBe(rel32(STUB_BASE + 0x54n, MODULE + HOOKS.keyUp.continuation))
    expect(down.readUInt32LE(0x50)).not.toBe(up.readUInt32LE(0x50))
  })
})

describe('no placeholder survives relocation', () => {
  // The appendix listings use recognisable junk for unresolved operands. If any
  // of it reaches the target, a stub is jumping or reading somewhere arbitrary.
  const placeholders = ['11111100', '00101111', '12345678', '78563412']
  const stubs = {
    collector: buildCollectorStub(args),
    frame: buildFrameStub(args),
    keyDown: buildKeyStub({ ...args, hook: HOOKS.keyDown }),
    keyUp: buildKeyStub({ ...args, hook: HOOKS.keyUp })
  }

  for (const [name, stub] of Object.entries(stubs)) {
    it(`${name} has no leftover placeholder`, () => {
      const hex = stub.toString('hex')
      for (const p of placeholders) expect(hex).not.toContain(p)
    })
  }

  it('the raw templates DO still contain them (so the check is meaningful)', () => {
    expect(parseHex(TEMPLATES.collector).toString('hex')).toContain('78563412')
    expect(parseHex(TEMPLATES.frame).toString('hex')).toContain('78563412')
  })
})
