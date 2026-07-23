import { describe, it, expect } from 'vitest'
import { HELPERS, HOOKS, PREFERRED_IMAGE_BASE, STATE, STATIC_SELECTOR } from './sites741.js'

// The appendix quotes static addresses (preferred image base 0x00400000); this
// file stores RVAs. These tests re-derive one from the other, so a transcription
// slip shows up here rather than as a jump into the middle of an instruction.

const staticOf = (rva) => PREFERRED_IMAGE_BASE + rva

describe('hook sites match their documented static addresses', () => {
  const expected = {
    keyDown: 0x00467c10n,
    keyUp: 0x00467e30n,
    framePane: 0x005ce280n,
    collector: 0x005d3740n,
    activateInactive: 0x004a9d81n
  }

  for (const [key, addr] of Object.entries(expected)) {
    it(`${key} is at ${addr.toString(16)}`, () => {
      expect(staticOf(HOOKS[key].rva)).toBe(addr)
    })
  }

  it('has a continuation exactly past its displaced bytes', () => {
    for (const hook of Object.values(HOOKS)) {
      expect(hook.continuation).toBe(hook.rva + BigInt(hook.displaced.length))
    }
  })

  it('displaces five bytes everywhere except the six-byte frame prologue', () => {
    expect(HOOKS.keyDown.displaced.length).toBe(5)
    expect(HOOKS.keyUp.displaced.length).toBe(5)
    expect(HOOKS.collector.displaced.length).toBe(5)
    expect(HOOKS.framePane.displaced.length).toBe(6)
    expect(HOOKS.activateInactive.displaced.length).toBe(5)
  })

  it('displaces whole instructions', () => {
    // push ebp; mov ebp,esp; push -1
    for (const key of ['keyDown', 'keyUp', 'collector']) {
      expect([...HOOKS[key].displaced]).toEqual([0x55, 0x8b, 0xec, 0x6a, 0xff])
    }
    // push ebp; mov ebp,esp; sub esp,0x1C
    expect([...HOOKS.framePane.displaced]).toEqual([0x55, 0x8b, 0xec, 0x83, 0xec, 0x1c])
  })
})

describe('helper addresses match their documented static addresses', () => {
  const expected = {
    inputGetEventManager: 0x00427380n,
    inputPostKeyUp: 0x00466e60n,
    getMessageTimeThunk: 0x0062006en,
    renderWorldObject: 0x005d3190n,
    uiPaneInvalidate: 0x00549f60n,
    originalActivationState: 0x004ac950n
  }

  for (const [key, addr] of Object.entries(expected)) {
    it(`${key} is at ${addr.toString(16)}`, () => {
      expect(staticOf(HELPERS[key])).toBe(addr)
    })
  }
})

describe('the WM_ACTIVATE call site', () => {
  it('originally calls the activation-state function', () => {
    // `E8 CA 2B 00 00` at 0x000A9D81 → next instruction 0x000A9D86, plus
    // 0x2BCA, lands on 0x000AC950. If that identity broke, either the site or
    // the helper address was transcribed wrong.
    const operand = HOOKS.activateInactive.displaced.readInt32LE(1)
    expect(HOOKS.activateInactive.continuation + BigInt(operand)).toBe(
      HELPERS.originalActivationState
    )
  })
})

describe('the state block', () => {
  it('is exactly big enough for its 255 entries', () => {
    expect(STATE.entries + STATE.maxEntries * STATE.entrySize).toBe(STATE.size)
    expect(STATE.size).toBe(0xcf4)
  })

  it('keeps the header fields inside the space before the entries', () => {
    for (const field of ['count', 'renderContext', 'canvas', 'worldPane']) {
      expect(STATE[field] + 4).toBeLessThanOrEqual(STATE.entries)
    }
  })
})

describe('the static mode selector', () => {
  it('is the 48 bytes the appendix says must survive untouched', () => {
    expect(STATIC_SELECTOR.bytes.length).toBe(48)
    expect(staticOf(STATIC_SELECTOR.rva)).toBe(0x005e487dn)
  })

  it('still contains the jungle-tree and native-translucent mode constants', () => {
    const hex = STATIC_SELECTOR.bytes.toString('hex')
    expect(hex).toContain('c745e86d000000') // mov dword [ebp-0x18], 0x6D
    expect(hex).toContain('c745e803000000') // mov dword [ebp-0x18], 3
    expect(hex).toContain('2580000000') // and eax, 0x80  (full-hide flag)
    expect(hex).toContain('83e240') // and edx, 0x40  (partial-hide flag)
  })
})
