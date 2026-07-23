// Stuck-modifier cleanup, built from
// darkages-741-re/docs/appendix/runtime-patches/stuck-modifiers.md.
//
// The client keeps its own pressed-key array. When the window loses focus the
// physical key-up goes to whatever took focus, so a held Alt (or Ctrl, or Shift)
// stays logically pressed. The ground-item hint reads that same Alt state, so a
// lost key-up would leave the overlay stuck on — which is why the appendix makes
// this patch a dependency of that one rather than an independent option.
//
// The hook replaces one CALL: the WA_INACTIVE branch of WM_ACTIVATE only. The
// active and click-active branches use a different call site and stay untouched,
// so the cleanup can only run on focus loss. The stub walks all 256 scan codes,
// posts a real key-up through the client's own input path for each pressed one,
// clears the cached modifier mask, and then jumps into the original
// activation-state function — returning through the return address the
// replacement CALL created.

import { buildStub, parseHex } from './x86.js'
import { HELPERS } from './sites741.js'

const CLEANUP_TEMPLATE = `
  9C                          // pushfd                      ; preserve caller flags
  60                          // pushad                      ; preserve registers
  E8 00 00 00 00              // call input_get_event_manager  <-- reloc 0x03
  85 C0                       // test eax, eax               ; a missing manager is safe
  74 32                       // je cleanup_done
  89 C3                       // mov ebx, eax                ; EBX = EventMan
  E8 00 00 00 00              // call GetMessageTime          <-- reloc 0x0E (import thunk)
  89 C7                       // mov edi, eax                ; timestamp for the events
  31 F6                       // xor esi, esi                ; scan_code = 0
                              // scan_loop:
  F6 84 33 34 03 00 00 80     // test byte [ebx+esi+0x334], 0x80  ; pressed?
  74 0D                       // je next_scan
  6A 00                       // push 0                      ; final argument
  57                          // push edi                    ; message timestamp
  6A 00                       // push 0                      ; repeat state
  56                          // push esi                    ; scan code
  89 D9                       // mov ecx, ebx                ; this = EventMan
  E8 00 00 00 00              // call input_post_key_up       <-- reloc 0x29
                              // next_scan:
  46                          // inc esi
  81 FE 00 01 00 00           // cmp esi, 256                ; the whole key array
  7C E0                       // jl scan_loop
  C6 83 34 04 00 00 00        // mov byte [ebx+0x434], 0     ; clear the modifier mask
                              // cleanup_done:
  61                          // popad
  9D                          // popfd
  E9 00 00 00 00              // jmp original_activation_state  <-- reloc 0x40
`

export const STUB_SIZE = 68

export const TEMPLATE = CLEANUP_TEMPLATE

export function buildModifierCleanupStub({ moduleBase, stubBase }) {
  return buildStub(CLEANUP_TEMPLATE, stubBase, [
    { offset: 0x03, kind: 'rel', target: moduleBase + HELPERS.inputGetEventManager },
    { offset: 0x0e, kind: 'rel', target: moduleBase + HELPERS.getMessageTimeThunk },
    { offset: 0x29, kind: 'rel', target: moduleBase + HELPERS.inputPostKeyUp },
    { offset: 0x40, kind: 'rel', target: moduleBase + HELPERS.originalActivationState }
  ])
}

export function templateLength() {
  return parseHex(CLEANUP_TEMPLATE).length
}
