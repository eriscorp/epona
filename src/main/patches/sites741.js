// Hook sites, helper functions and byte signatures for the version-7.41 client.
//
// Source: darkages-741-re/docs/appendix/runtime-patches/{ground-item-hints,
// stuck-modifiers,safe-launcher}.md, plus docs/appendix/functions.md for the
// helper addresses the stubs call into.
//
// Everything here is an **RVA** — an offset from the loaded module base, never a
// runtime pointer. The appendix quotes static addresses assuming the preferred
// image base 0x00400000; each RVA below is that address minus 0x400000, and the
// unit tests assert the pair still lines up.
//
// These addresses are 7.41 ONLY. 7.37/7.39/7.40 have different layouts and the
// appendix does not cover them, so groundItemHints is gated on versionCode 741.

export const PREFERRED_IMAGE_BASE = 0x00400000n

// A hook site: where the jump goes, how many bytes it displaces, and the exact
// prologue we expect to find there. If the bytes differ we are not looking at
// the client we think we are, and installation stops.
//
// `continuation` is where the relocated prologue jumps back to — always
// `rva + displaced.length`, asserted in tests.
export const HOOKS = {
  keyDown: {
    name: 'input_emit_key_down',
    rva: 0x00067c10n,
    displaced: Buffer.from([0x55, 0x8b, 0xec, 0x6a, 0xff]), // push ebp; mov ebp,esp; push -1
    continuation: 0x00067c15n
  },
  keyUp: {
    name: 'input_emit_key_up',
    rva: 0x00067e30n,
    displaced: Buffer.from([0x55, 0x8b, 0xec, 0x6a, 0xff]),
    continuation: 0x00067e35n
  },
  framePane: {
    name: 'render_world_pane_content',
    rva: 0x001ce280n,
    // Six bytes displaced, so the 5-byte jump is padded with one NOP.
    displaced: Buffer.from([0x55, 0x8b, 0xec, 0x83, 0xec, 0x1c]), // ...; sub esp,0x1C
    continuation: 0x001ce286n
  },
  collector: {
    name: 'render_collect_world_objects',
    rva: 0x001d3740n,
    displaced: Buffer.from([0x55, 0x8b, 0xec, 0x6a, 0xff]),
    continuation: 0x001d3745n
  },
  // Stuck-modifier cleanup replaces a CALL rather than a prologue: only the
  // WA_INACTIVE branch of WM_ACTIVATE, so the active/click-active path is
  // untouched. The original operand encodes the activation-state function —
  // 0x000A9D86 + 0x2BCA == 0x000AC950 — which the tests verify.
  activateInactive: {
    name: 'WM_ACTIVATE inactive call site',
    rva: 0x000a9d81n,
    displaced: Buffer.from([0xe8, 0xca, 0x2b, 0x00, 0x00]), // call original_activation_state
    continuation: 0x000a9d86n
  }
}

// Functions and data the stubs reach into.
export const HELPERS = {
  inputGetEventManager: 0x00027380n,
  inputPostKeyUp: 0x00066e60n,
  getMessageTimeThunk: 0x0022006en, // executable import thunk — call it, don't deref it
  renderWorldObject: 0x001d3190n,
  uiPaneInvalidate: 0x00149f60n,
  originalActivationState: 0x000ac950n,
  // WorldObject_Item's primary vtable. An entry is only touched when its vtable
  // pointer matches this exactly — that's what keeps walls, foliage, players and
  // effects out of the hint pass.
  itemVtable: 0x0028b1acn
}

// The static mode selector the ground-item patch must NOT change. Verified and
// left alone: its survival is the proof that SOTP flag 0x80 (full hide), flag
// 0x40 (partial hide) and jungle-tree mode 0x6D still behave normally.
export const STATIC_SELECTOR = {
  rva: 0x001e487dn,
  bytes: Buffer.from(
    [
      '8B55D0', // mov edx, [ebp-0x30]
      '0FB682B9000000', // movzx eax, byte [edx+0xB9]
      '2580000000', // and eax, 0x80
      '7409', // je test_partial_hide
      'C745E86D000000', // mov dword [ebp-0x18], 0x6D
      'EB16', // jmp selector_done
      '8B4DD0', // mov ecx, [ebp-0x30]
      '0FB691B9000000', // movzx edx, byte [ecx+0xB9]
      '83E240', // and edx, 0x40
      '7407', // je selector_done
      'C745E803000000' // mov dword [ebp-0x18], 3
    ].join(''),
    'hex'
  )
}

// Layout of the launcher-allocated state block the ground-item stubs share.
// The fixed entry cap is deliberate: a damaged or unexpectedly large draw queue
// can then only be ignored, never used to run past the end of our own memory.
export const STATE = {
  size: 0x0cf4,
  count: 0x000,
  renderContext: 0x004,
  canvas: 0x008,
  worldPane: 0x028,
  entries: 0x100,
  maxEntries: 255,
  entrySize: 12
}
