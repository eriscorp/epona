// Installs the ground-item hint hooks into a suspended client.
//
// Order and safety rules come from
// darkages-741-re/docs/appendix/runtime-patches/safe-launcher.md:
//
//   verify every original byte  →  allocate state + stubs  →  fill relocations
//   →  make the stubs executable  →  verify what we wrote  →  install the jumps
//   →  verify them  →  flush the instruction cache  →  only then resume
//
// Nothing is written until every check passes, and any failure rewinds in
// reverse order: restore hooks first, free stubs only once no hook can still
// jump into them. A partially patched client is never resumed — the caller
// terminates it.
//
// The Win32 surface is injected as `mem` so the whole sequence can be driven by
// a fake in tests; production passes the da-win32 bridge.

import { buildCollectorStub, buildFrameStub, buildKeyStub, STUB_SIZES } from './groundItemHints.js'
import { buildModifierCleanupStub, STUB_SIZE as MODIFIER_STUB_SIZE } from './stuckModifiers.js'
import { buildCall, buildJump } from './x86.js'
import { HOOKS, STATE, STATIC_SELECTOR } from './sites741.js'

// Stubs are laid out back to back in one allocation, each starting on a 16-byte
// boundary. One allocation keeps the bookkeeping (and the rollback) simple.
const ALIGN = 16
const align = (n) => Math.ceil(n / ALIGN) * ALIGN

// Which stub goes where, in bytes from the base of the stub allocation.
export function planStubLayout() {
  const order = [
    ['collector', STUB_SIZES.collector],
    ['frame', STUB_SIZES.frame],
    ['keyDown', STUB_SIZES.keyDown],
    ['keyUp', STUB_SIZES.keyUp],
    ['modifiers', MODIFIER_STUB_SIZE]
  ]
  const offsets = {}
  let cursor = 0
  for (const [name, size] of order) {
    offsets[name] = cursor
    cursor = align(cursor + size)
  }
  return { offsets, totalSize: cursor }
}

// Read `expected.length` bytes at `rva` and compare. The message names the site
// so a mismatch tells the user which check failed, not just that one did.
function verifyBytes(mem, handle, moduleBase, rva, expected, what) {
  const actual = mem.readProcessMemory(handle, moduleBase + rva, expected.length)
  if (!actual.equals(expected)) {
    throw new Error(
      `${what}: expected ${expected.toString('hex')} at +0x${rva.toString(16)}, ` +
        `found ${actual.toString('hex')}. This is not the client build these ` +
        `patch addresses were derived from — nothing was changed.`
    )
  }
}

// Every read-only check, done before a single byte is written.
export function verifyTarget(mem, handle, moduleBase) {
  for (const hook of Object.values(HOOKS)) {
    verifyBytes(mem, handle, moduleBase, hook.rva, hook.displaced, `${hook.name} prologue`)
  }
  // The static mode selector is verified and then deliberately left alone: its
  // survival is what proves SOTP full-hide, partial-hide and jungle-tree
  // rendering still behave exactly as they did.
  verifyBytes(
    mem,
    handle,
    moduleBase,
    STATIC_SELECTOR.rva,
    STATIC_SELECTOR.bytes,
    'static mode selector'
  )
}

// Write a buffer and read it straight back. Cheap next to the cost of resuming a
// client whose hook only half landed.
function writeVerified(mem, handle, address, bytes, what) {
  mem.writeProcessMemory(handle, address, bytes)
  const back = mem.readProcessMemory(handle, address, bytes.length)
  if (!back.equals(bytes)) throw new Error(`${what}: write-back verification failed`)
}

// Install the ground-item hint patch (and the stuck-modifier cleanup it
// depends on) into an already-suspended process.
//
//   mem        — the da-win32 bridge (injectable for tests)
//   handle     — a process handle with VM read/write/operation rights
//   moduleBase — the loaded main-module base, as a BigInt
//
// Returns { stateBase, stubBase } on success. Throws with everything undone on
// failure — the caller must not resume the process after a throw.
export function installGroundItemHints({ mem, handle, moduleBase }) {
  verifyTarget(mem, handle, moduleBase)

  const { offsets, totalSize } = planStubLayout()
  let stateBase = null
  let stubBase = null
  // Hooks we've already installed, newest last, so rollback can walk backwards.
  const installed = []

  const rollback = () => {
    // Restore the original bytes first: while any hook is live it can still jump
    // into the stub allocation, so freeing that memory first would be a race.
    for (const { rva, original } of [...installed].reverse()) {
      try {
        mem.writeProcessMemory(handle, moduleBase + rva, original)
        mem.flushInstructionCache(handle, moduleBase + rva, original.length)
      } catch {
        /* best effort — the caller terminates the process anyway */
      }
    }
    for (const base of [stubBase, stateBase]) {
      if (base === null) continue
      try {
        mem.virtualFreeEx(handle, base)
      } catch {
        /* best effort */
      }
    }
  }

  try {
    // 1. State: read/write only, never executable. Zeroed by VirtualAllocEx.
    stateBase = mem.virtualAllocEx(
      handle,
      STATE.size,
      mem.MEM_COMMIT | mem.MEM_RESERVE,
      mem.PAGE_READWRITE
    )

    // 2. Stubs: writable while we fill them, executable before anything can run.
    stubBase = mem.virtualAllocEx(
      handle,
      totalSize,
      mem.MEM_COMMIT | mem.MEM_RESERVE,
      mem.PAGE_READWRITE
    )

    const at = (name) => stubBase + BigInt(offsets[name])
    const stubs = {
      collector: buildCollectorStub({ moduleBase, stateBase, stubBase: at('collector') }),
      frame: buildFrameStub({ moduleBase, stateBase, stubBase: at('frame') }),
      keyDown: buildKeyStub({
        moduleBase,
        stateBase,
        stubBase: at('keyDown'),
        hook: HOOKS.keyDown
      }),
      keyUp: buildKeyStub({ moduleBase, stateBase, stubBase: at('keyUp'), hook: HOOKS.keyUp }),
      modifiers: buildModifierCleanupStub({ moduleBase, stubBase: at('modifiers') })
    }

    for (const [name, bytes] of Object.entries(stubs)) {
      writeVerified(mem, handle, at(name), bytes, `${name} stub`)
    }

    // 3. Executable, then flushed — before any hook can reach this memory.
    mem.virtualProtectEx(handle, stubBase, totalSize, mem.PAGE_EXECUTE_READ)
    mem.flushInstructionCache(handle, stubBase, totalSize)

    // 4. Install the hooks. Four prologue jumps plus one replaced call. Each is
    //    verified as it lands, and recorded so rollback can undo it.
    const hookPlan = [
      { hook: HOOKS.collector, redirect: at('collector') },
      { hook: HOOKS.framePane, redirect: at('frame') },
      { hook: HOOKS.keyDown, redirect: at('keyDown') },
      { hook: HOOKS.keyUp, redirect: at('keyUp') },
      { hook: HOOKS.activateInactive, redirect: at('modifiers'), kind: 'call' }
    ]

    for (const { hook, redirect, kind } of hookPlan) {
      const address = moduleBase + hook.rva
      const patch =
        kind === 'call'
          ? buildCall(address, redirect)
          : buildJump(address, redirect, hook.displaced.length)
      if (patch.length !== hook.displaced.length) {
        throw new Error(
          `${hook.name}: patch length ${patch.length} would leave a partial instruction`
        )
      }
      const previousProtect = mem.virtualProtectEx(
        handle,
        address,
        patch.length,
        mem.PAGE_EXECUTE_READWRITE
      )
      try {
        writeVerified(mem, handle, address, patch, `${hook.name} hook`)
        installed.push({ rva: hook.rva, original: hook.displaced })
      } finally {
        // Put the page back the way we found it whether or not the write held.
        try {
          mem.virtualProtectEx(handle, address, patch.length, previousProtect)
        } catch {
          /* the write already succeeded or already threw */
        }
      }
      mem.flushInstructionCache(handle, address, patch.length)
    }

    return { stateBase, stubBase }
  } catch (err) {
    rollback()
    throw err
  }
}
