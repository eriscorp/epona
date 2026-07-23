// Ground-item hint stubs, built byte-for-byte from
// darkages-741-re/docs/appendix/runtime-patches/ground-item-hints.md.
//
// What the patch does, in one frame: the collector hook copies every visible
// layer-4 ground item out of the completed draw queue into launcher-owned state;
// the frame hook then replays those entries with blend mode 3 after the normal
// world pane has finished drawing, but only while an Alt key is held. Two more
// hooks invalidate the pane on Alt down/up so the change is immediate rather
// than waiting for the next dirty event.
//
// The templates below are the appendix listings verbatim, placeholders and all.
// Every placeholder is named in the relocation list next to it, so a forgotten
// one is a missing-key error at build time rather than a jump into nowhere.
// Nothing here touches the process — these are pure functions over Buffers, and
// the tests assert the exact bytes.

import { buildStub, parseHex } from './x86.js'
import { HELPERS, HOOKS, STATE } from './sites741.js'

// Wraps render_collect_world_objects. Runs the original collection first, then
// walks the finished layer-4 vector at [esi+0xE0]..[esi+0xE4] and copies each
// eligible 12-byte draw record into our state. An entry qualifies only when its
// object pointer is non-null, its primary vtable is exactly WorldObject_Item's,
// and its blend mode is the ordinary 1 — which is what keeps walls, foliage,
// players, monsters and effects out of the hint pass. Stops at 255 entries.
const COLLECTOR_TEMPLATE = `
  55                          // push ebp                    ; wrapper frame
  89 E5                       // mov ebp, esp
  83 EC 08                    // sub esp, 8                  ; saved-result locals
  53 56 57                    // push ebx / esi / edi
  89 CE                       // mov esi, ecx                ; keep the render-list owner
  FF 75 18                    // push [ebp+0x18]             ; forward arg 5
  FF 75 14                    // push [ebp+0x14]             ; arg 4
  FF 75 10                    // push [ebp+0x10]             ; arg 3
  FF 75 0C                    // push [ebp+0x0C]             ; arg 2
  FF 75 08                    // push [ebp+0x08]             ; arg 1 (canvas)
  89 F1                       // mov ecx, esi                ; restore this
  E8 72 00 00 00              // call original_collector     ; local gateway at 0x93
  89 45 FC                    // mov [ebp-4], eax            ; preserve the result
  8B BE E0 00 00 00           // mov edi, [esi+0xE0]         ; first draw record
                              // scan_records:
  3B BE E4 00 00 00           // cmp edi, [esi+0xE4]         ; end of records?
  73 55                       // jae collector_done
  8B 17                       // mov edx, [edi]              ; the world object
  85 D2                       // test edx, edx
  74 4A                       // je next_record
  81 3A 78 56 34 12           // cmp [edx], item_vtable      <-- reloc 0x3A
  75 42                       // jne next_record
  83 BA B0 00 00 00 01        // cmp dword [edx+0xB0], 1     ; ordinary blend mode only
  75 39                       // jne next_record
  A1 00 10 11 11              // mov eax, [state.count]      <-- reloc 0x4A
  3D FF 00 00 00              // cmp eax, 255                ; fixed capacity
  73 32                       // jae collector_done
  6B D8 0C                    // imul ebx, eax, 12
  81 C3 00 11 11 11           // add ebx, state.entries      <-- reloc 0x5A
  8B 0F                       // mov ecx, [edi]              ; copy the 12-byte record
  89 0B                       // mov [ebx], ecx
  8B 4F 04                    // mov ecx, [edi+4]
  89 4B 04                    // mov [ebx+4], ecx
  8B 4F 08                    // mov ecx, [edi+8]
  89 4B 08                    // mov [ebx+8], ecx
  FF 05 00 10 11 11           // inc dword [state.count]     <-- reloc 0x70
  89 35 04 10 11 11           // mov [state.render_context], esi  <-- reloc 0x76
  8B 45 08                    // mov eax, [ebp+8]            ; the canvas argument
  A3 08 10 11 11              // mov [state.canvas], eax     <-- reloc 0x7E
                              // next_record:
  83 C7 0C                    // add edi, 12
  EB A3                       // jmp scan_records
                              // collector_done:
  8B 45 FC                    // mov eax, [ebp-4]            ; the original result
  5F 5E 5B                    // pop edi / esi / ebx
  89 EC                       // mov esp, ebp
  5D                          // pop ebp
  C2 14 00                    // ret 0x14                    ; original stack cleanup
                              // original_collector:
  55                          // push ebp                    ; displaced prologue
  89 E5                       // mov ebp, esp
  6A FF                       // push -1
  E9 63 FF FF 11              // jmp collector_continuation  <-- reloc 0x99
`

// Wraps render_world_pane_content. Saves the live WorldPane (the key hooks need
// it to invalidate), resets the capture count, runs the normal draw — during
// which the collector above refills the state — then, only while Alt is down,
// replays each captured item with blend mode 3 and restores its original mode
// immediately. Every entry is revalidated before use: the pointer, the exact
// item vtable, and the blend mode.
const FRAME_TEMPLATE = `
  55                          // push ebp
  89 E5                       // mov ebp, esp
  83 EC 10                    // sub esp, 0x10               ; result + blend locals
  53 56 57                    // push ebx / esi / edi
  89 CE                       // mov esi, ecx                ; keep the world pane
  89 35 28 10 11 11           // mov [state.world_pane], esi <-- reloc 0x0D
  C7 05 00 10 11 11 00 00 00 00 // mov dword [state.count], 0  <-- reloc 0x13
  89 F1                       // mov ecx, esi
  E8 8D 00 00 00              // call original_frame_draw    ; local gateway at 0xAF
  89 45 FC                    // mov [ebp-4], eax
  E8 D6 FF FF EF              // call input_get_event_manager  <-- reloc 0x26
  85 C0                       // test eax, eax               ; no manager, no hint
  74 77                       // je replay_done
  F6 80 34 04 00 00 01        // test byte [eax+0x434], 1    ; either Alt down?
  74 6E                       // je replay_done
  31 FF                       // xor edi, edi
                              // replay_loop:
  3B 3D 00 10 11 11           // cmp edi, [state.count]      <-- reloc 0x3B
  73 64                       // jae replay_done
  6B C7 0C                    // imul eax, edi, 12
  8D 98 00 11 11 11           // lea ebx, [eax+state.entries]  <-- reloc 0x46
  8B 13                       // mov edx, [ebx]
  85 D2                       // test edx, edx               ; skip a stale record
  74 52                       // je next_replay
  81 3A 78 56 34 12           // cmp [edx], item_vtable      <-- reloc 0x52
  75 4A                       // jne next_replay
  83 BA B0 00 00 00 01        // cmp dword [edx+0xB0], 1     ; recheck blend state
  75 41                       // jne next_replay
  89 55 F4                    // mov [ebp-0x0C], edx         ; save across the call
  8B 82 B0 00 00 00           // mov eax, [edx+0xB0]         ; save original blend mode
  89 45 F8                    // mov [ebp-8], eax
  C7 82 B0 00 00 00 03 00 00 00 // mov dword [edx+0xB0], 3   ; draw this copy faded
  8B 0D 04 10 11 11           // mov ecx, [state.render_context]  <-- reloc 0x79
  8B 81 BC 02 00 00           // mov eax, [ecx+0x2BC]        ; category-state table
  8B 55 F4                    // mov edx, [ebp-0x0C]
  03 42 2C                    // add eax, [edx+0x2C]         ; its broad category
  50                          // push eax                    ; category state
  53                          // push ebx                    ; the saved draw record
  FF 35 08 10 11 11           // push dword [state.canvas]   <-- reloc 0x8D
  E8 6A FF FF F0              // call render_world_object    <-- reloc 0x92
  8B 55 F4                    // mov edx, [ebp-0x0C]
  8B 45 F8                    // mov eax, [ebp-8]
  89 82 B0 00 00 00           // mov [edx+0xB0], eax         ; restore it immediately
                              // next_replay:
  47                          // inc edi
  EB 94                       // jmp replay_loop
                              // replay_done:
  8B 45 FC                    // mov eax, [ebp-4]
  5F 5E 5B                    // pop edi / esi / ebx
  89 EC                       // mov esp, ebp
  5D                          // pop ebp
  C3                          // ret                         ; original convention
                              // original_frame_draw:
  55                          // push ebp                    ; displaced prologue
  89 E5                       // mov ebp, esp
  83 EC 1C                    // sub esp, 0x1C
  E9 46 FF FF F1              // jmp frame_continuation      <-- reloc 0xB6
`

// Wraps input_emit_key_down / input_emit_key_up. Same template for both; only
// the continuation differs. Runs the original handler first, then invalidates
// the last-seen world pane when the raw scan code is either Alt (0x38 left,
// 0xB8 right) — so the overlay appears and disappears on the transition instead
// of waiting for the next dirty event.
const KEY_TEMPLATE = `
  55                          // push ebp
  89 E5                       // mov ebp, esp
  83 EC 08                    // sub esp, 8
  56                          // push esi
  89 CE                       // mov esi, ecx
  FF 75 14                    // push [ebp+0x14]             ; forward arg 4
  FF 75 10                    // push [ebp+0x10]             ; arg 3
  FF 75 0C                    // push [ebp+0x0C]             ; arg 2
  FF 75 08                    // push [ebp+0x08]             ; raw scan code
  89 F1                       // mov ecx, esi
  E8 2E 00 00 00              // call original_key_event     ; local gateway at 0x4A
  89 45 FC                    // mov [ebp-4], eax
  0F B6 45 08                 // movzx eax, byte [ebp+8]     ; raw scan code
  83 F8 38                    // cmp eax, 0x38               ; left Alt?
  74 07                       // je invalidate_world
  3D B8 00 00 00              // cmp eax, 0xB8               ; right Alt?
  75 11                       // jne key_done
                              // invalidate_world:
  8B 0D 28 10 11 11           // mov ecx, [state.world_pane] <-- reloc 0x31
  85 C9                       // test ecx, ecx               ; nothing before frame 1
  74 07                       // je key_done
  6A 00                       // push 0                      ; no dirty rectangle
  E8 C0 FF FF E2              // call ui_pane_invalidate     <-- reloc 0x3C
                              // key_done:
  8B 45 FC                    // mov eax, [ebp-4]
  5E                          // pop esi
  89 EC                       // mov esp, ebp
  5D                          // pop ebp
  C2 10 00                    // ret 0x10
                              // original_key_event:
  55                          // push ebp                    ; displaced prologue
  89 E5                       // mov ebp, esp
  6A FF                       // push -1
  E9 AC FF FF E3              // jmp key_event_continuation  <-- reloc 0x50
`

// Sizes the appendix states, so a template edit that changes a length fails the
// test instead of shifting every relocation silently.
export const STUB_SIZES = {
  collector: 157,
  frame: 186,
  keyDown: 84,
  keyUp: 84
}

export const TEMPLATES = {
  collector: COLLECTOR_TEMPLATE,
  frame: FRAME_TEMPLATE,
  key: KEY_TEMPLATE
}

const abs = (offset, target) => ({ offset, kind: 'abs', target })
const rel = (offset, target) => ({ offset, kind: 'rel', target })

export function buildCollectorStub({ moduleBase, stateBase, stubBase }) {
  return buildStub(COLLECTOR_TEMPLATE, stubBase, [
    abs(0x3a, moduleBase + HELPERS.itemVtable),
    abs(0x4a, stateBase + BigInt(STATE.count)),
    abs(0x5a, stateBase + BigInt(STATE.entries)),
    abs(0x70, stateBase + BigInt(STATE.count)),
    abs(0x76, stateBase + BigInt(STATE.renderContext)),
    abs(0x7e, stateBase + BigInt(STATE.canvas)),
    rel(0x99, moduleBase + HOOKS.collector.continuation)
  ])
}

export function buildFrameStub({ moduleBase, stateBase, stubBase }) {
  return buildStub(FRAME_TEMPLATE, stubBase, [
    abs(0x0d, stateBase + BigInt(STATE.worldPane)),
    abs(0x13, stateBase + BigInt(STATE.count)),
    rel(0x26, moduleBase + HELPERS.inputGetEventManager),
    abs(0x3b, stateBase + BigInt(STATE.count)),
    abs(0x46, stateBase + BigInt(STATE.entries)),
    abs(0x52, moduleBase + HELPERS.itemVtable),
    abs(0x79, stateBase + BigInt(STATE.renderContext)),
    abs(0x8d, stateBase + BigInt(STATE.canvas)),
    rel(0x92, moduleBase + HELPERS.renderWorldObject),
    rel(0xb6, moduleBase + HOOKS.framePane.continuation)
  ])
}

// `hook` is HOOKS.keyDown or HOOKS.keyUp — the only difference between the two.
export function buildKeyStub({ moduleBase, stateBase, stubBase, hook }) {
  return buildStub(KEY_TEMPLATE, stubBase, [
    abs(0x31, stateBase + BigInt(STATE.worldPane)),
    rel(0x3c, moduleBase + HELPERS.uiPaneInvalidate),
    rel(0x50, moduleBase + hook.continuation)
  ])
}

// Unrelocated template lengths, for the size assertions above.
export function templateLengths() {
  return {
    collector: parseHex(COLLECTOR_TEMPLATE).length,
    frame: parseHex(FRAME_TEMPLATE).length,
    key: parseHex(KEY_TEMPLATE).length
  }
}
