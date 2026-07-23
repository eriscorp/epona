import { describe, it, expect, vi } from 'vitest'
import { installGroundItemHints, planStubLayout, verifyTarget } from './installer.js'
import { HOOKS, STATIC_SELECTOR } from './sites741.js'
import { STUB_SIZES } from './groundItemHints.js'
import { STUB_SIZE as MODIFIER_STUB_SIZE } from './stuckModifiers.js'

const MODULE = 0x00400000n

// A stand-in for the target process: sparse memory plus a log of every Win32
// call, so the tests can assert both the bytes that landed and the order the
// steps happened in (which is the part safe-launcher.md actually specifies).
function fakeTarget({ failAt = null } = {}) {
  const bytes = new Map() // address (BigInt) -> byte
  const allocations = []
  const calls = []
  let nextAlloc = 0x10000000n

  const write = (address, buf) => {
    for (let i = 0; i < buf.length; i++) bytes.set(address + BigInt(i), buf[i])
  }
  const read = (address, size) => {
    const out = Buffer.alloc(size)
    for (let i = 0; i < size; i++) out[i] = bytes.get(address + BigInt(i)) ?? 0
    return out
  }

  // Seed the client image with the prologues and the static selector the
  // verifier expects to find.
  for (const hook of Object.values(HOOKS)) write(MODULE + hook.rva, hook.displaced)
  write(MODULE + STATIC_SELECTOR.rva, STATIC_SELECTOR.bytes)

  const maybeFail = (step) => {
    calls.push(step)
    if (failAt && step.startsWith(failAt)) throw new Error(`injected failure at ${step}`)
  }

  return {
    calls,
    allocations,
    read,
    imageByte: (rva) => bytes.get(MODULE + rva),
    imageBytes: (rva, size) => read(MODULE + rva, size),
    mem: {
      MEM_COMMIT: 0x1000,
      MEM_RESERVE: 0x2000,
      PAGE_READWRITE: 0x04,
      PAGE_EXECUTE_READ: 0x20,
      PAGE_EXECUTE_READWRITE: 0x40,
      readProcessMemory: (_h, address, size) => read(address, size),
      writeProcessMemory: (_h, address, buf) => {
        maybeFail(`write:${address.toString(16)}`)
        write(address, buf)
      },
      virtualAllocEx: (_h, size, _type, protect) => {
        maybeFail(`alloc:${size}`)
        const base = nextAlloc
        nextAlloc += BigInt(Math.ceil(size / 0x10000) * 0x10000)
        allocations.push({ base, size, protect, freed: false })
        write(base, Buffer.alloc(size)) // VirtualAllocEx hands back zeroed pages
        return base
      },
      virtualFreeEx: (_h, base) => {
        calls.push(`free:${base.toString(16)}`)
        const alloc = allocations.find((a) => a.base === base)
        if (alloc) alloc.freed = true
      },
      virtualProtectEx: (_h, address, _size, protect) => {
        maybeFail(`protect:${address.toString(16)}:${protect}`)
        return 0x20 // pretend the pages were PAGE_EXECUTE_READ
      },
      flushInstructionCache: (_h, address, size) => {
        calls.push(`flush:${address.toString(16)}:${size}`)
      }
    }
  }
}

describe('planStubLayout', () => {
  it('gives every stub a 16-byte-aligned home that fits', () => {
    const { offsets, totalSize } = planStubLayout()
    const sizes = { ...STUB_SIZES, modifiers: MODIFIER_STUB_SIZE }
    for (const [name, offset] of Object.entries(offsets)) {
      expect(offset % 16).toBe(0)
      expect(offset + sizes[name]).toBeLessThanOrEqual(totalSize)
    }
  })

  it('never overlaps two stubs', () => {
    const { offsets } = planStubLayout()
    const sizes = { ...STUB_SIZES, modifiers: MODIFIER_STUB_SIZE }
    const spans = Object.entries(offsets)
      .map(([name, start]) => ({ start, end: start + sizes[name] }))
      .sort((a, b) => a.start - b.start)
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
    }
  })
})

describe('verifyTarget', () => {
  it('passes against the expected client', () => {
    const t = fakeTarget()
    expect(() => verifyTarget(t.mem, 1n, MODULE)).not.toThrow()
  })

  it('refuses a client whose prologue differs, naming the site', () => {
    const t = fakeTarget()
    t.mem.writeProcessMemory(
      1n,
      MODULE + HOOKS.collector.rva,
      Buffer.from([0x90, 0x90, 0x90, 0x90, 0x90])
    )
    expect(() => verifyTarget(t.mem, 1n, MODULE)).toThrow(/render_collect_world_objects prologue/)
  })

  it('refuses a client whose static mode selector differs', () => {
    // The selector is never written — but if it isn't what we expect, the
    // rendering assumptions behind the whole patch don't hold.
    const t = fakeTarget()
    t.mem.writeProcessMemory(1n, MODULE + STATIC_SELECTOR.rva, Buffer.alloc(48, 0x90))
    expect(() => verifyTarget(t.mem, 1n, MODULE)).toThrow(/static mode selector/)
  })
})

describe('installGroundItemHints', () => {
  it('installs all five hooks and reports where its memory went', () => {
    const t = fakeTarget()
    const result = installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })

    expect(result.stateBase).toBeTypeOf('bigint')
    expect(result.stubBase).toBeTypeOf('bigint')

    // Four prologue jumps...
    for (const key of ['collector', 'framePane', 'keyDown', 'keyUp']) {
      expect(t.imageByte(HOOKS[key].rva)).toBe(0xe9)
    }
    // ...and one replaced call.
    expect(t.imageByte(HOOKS.activateInactive.rva)).toBe(0xe8)
  })

  it('pads the six-byte frame prologue so no half instruction is left', () => {
    const t = fakeTarget()
    installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })
    const patched = t.imageBytes(HOOKS.framePane.rva, 6)
    expect(patched[0]).toBe(0xe9)
    expect(patched[5]).toBe(0x90) // the sixth displaced byte, NOPed
  })

  it('leaves the static mode selector untouched', () => {
    const t = fakeTarget()
    installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })
    expect(t.imageBytes(STATIC_SELECTOR.rva, 48).equals(STATIC_SELECTOR.bytes)).toBe(true)
  })

  it('allocates state as non-executable and stubs as executable', () => {
    const t = fakeTarget()
    installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })
    // Both allocations start writable; only the stub region is later made
    // executable. The state block must never be.
    expect(t.allocations.every((a) => a.protect === t.mem.PAGE_READWRITE)).toBe(true)
    const stubProtect = t.calls.find((c) => c.startsWith('protect:') && c.endsWith(':32'))
    expect(stubProtect).toBeTruthy()
  })

  it('makes the stubs executable and flushes them BEFORE any hook is installed', () => {
    // The ordering rule from safe-launcher.md: nothing may be able to jump into
    // the stub region until that region is finished and cached correctly.
    const t = fakeTarget()
    const { stubBase } = installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })

    const stubFlush = t.calls.indexOf(
      t.calls.find((c) => c.startsWith(`flush:${stubBase.toString(16)}:`))
    )
    const firstHookWrite = t.calls.indexOf(
      t.calls.find((c) => c === `write:${(MODULE + HOOKS.collector.rva).toString(16)}`)
    )
    expect(stubFlush).toBeGreaterThan(-1)
    expect(firstHookWrite).toBeGreaterThan(stubFlush)
  })

  it('flushes the instruction cache for every hook site it writes', () => {
    const t = fakeTarget()
    installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })
    for (const hook of Object.values(HOOKS)) {
      const address = (MODULE + hook.rva).toString(16)
      expect(t.calls.some((c) => c.startsWith(`flush:${address}:`))).toBe(true)
    }
  })

  it('verifies before it writes — a bad client is never touched', () => {
    const t = fakeTarget()
    t.mem.writeProcessMemory(1n, MODULE + HOOKS.keyUp.rva, Buffer.alloc(5, 0x90))
    const before = t.calls.length

    expect(() => installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })).toThrow(
      /input_emit_key_up prologue/
    )
    // Nothing was allocated and nothing was written after the failed check.
    expect(t.allocations).toEqual([])
    expect(t.calls.slice(before).filter((c) => c.startsWith('write:'))).toEqual([])
  })
})

describe('rollback', () => {
  it('restores every installed hook when a later one fails', () => {
    // Fail on the key-up hook write: the collector, frame and key-down hooks
    // are already in, and all of them must come back out.
    const keyUpAddress = (MODULE + HOOKS.keyUp.rva).toString(16)
    const t = fakeTarget({ failAt: `write:${keyUpAddress}` })

    expect(() => installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })).toThrow(
      /injected failure/
    )

    for (const hook of Object.values(HOOKS)) {
      expect(t.imageBytes(hook.rva, hook.displaced.length).equals(hook.displaced)).toBe(true)
    }
  })

  it('frees both allocations, and only after the hooks are restored', () => {
    const keyUpAddress = (MODULE + HOOKS.keyUp.rva).toString(16)
    const t = fakeTarget({ failAt: `write:${keyUpAddress}` })
    expect(() => installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })).toThrow()

    expect(t.allocations.length).toBe(2)
    expect(t.allocations.every((a) => a.freed)).toBe(true)

    // A live hook could still jump into the stub region, so the restore has to
    // come first.
    const lastRestore = t.calls
      .map((c, i) => [c, i])
      .filter(([c]) => c.startsWith('write:'))
      .pop()[1]
    const firstFree = t.calls.findIndex((c) => c.startsWith('free:'))
    expect(firstFree).toBeGreaterThan(lastRestore)
  })

  it('cleans up when the very first allocation fails', () => {
    const t = fakeTarget({ failAt: 'alloc:' })
    expect(() => installGroundItemHints({ mem: t.mem, handle: 1n, moduleBase: MODULE })).toThrow(
      /injected failure/
    )
    for (const hook of Object.values(HOOKS)) {
      expect(t.imageBytes(hook.rva, hook.displaced.length).equals(hook.displaced)).toBe(true)
    }
  })

  it('reports the original failure even when the teardown itself fails', () => {
    // Best-effort teardown: the caller terminates the suspended process anyway,
    // so a restore or free that throws must not replace the error that explains
    // what actually went wrong.
    const t = fakeTarget()
    const siteFor = (address) =>
      Object.values(HOOKS).find((hook) => MODULE + hook.rva === address) ?? null

    const failing = {
      ...t.mem,
      writeProcessMemory: vi.fn((h, address, buf) => {
        const site = siteFor(address)
        // A write of the original bytes back over a hook site is a restore.
        if (site && buf.equals(site.displaced)) throw new Error('restore also fails')
        if (address === MODULE + HOOKS.keyUp.rva) throw new Error('injected failure at key-up')
        return t.mem.writeProcessMemory(h, address, buf)
      }),
      virtualFreeEx: vi.fn(() => {
        throw new Error('free also fails')
      })
    }

    expect(() => installGroundItemHints({ mem: failing, handle: 1n, moduleBase: MODULE })).toThrow(
      /injected failure at key-up/
    )
    // It really did try to undo both kinds of work before giving up.
    expect(failing.virtualFreeEx).toHaveBeenCalledTimes(2)
  })
})
