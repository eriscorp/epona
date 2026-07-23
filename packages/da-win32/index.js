const addon = require('./build/Release/da_win32.node')

// Win32 process access flags
const PROCESS_VM_READ = 0x0010
const PROCESS_VM_WRITE = 0x0020
const PROCESS_VM_OPERATION = 0x0008
const PROCESS_QUERY_INFORMATION = 0x0400
const PROCESS_ALL_ACCESS = 0x001f0fff

// VirtualAllocEx / VirtualProtectEx flags, for the runtime hook patches.
const MEM_COMMIT = 0x1000
const MEM_RESERVE = 0x2000
const PAGE_READWRITE = 0x04
const PAGE_EXECUTE_READ = 0x20
const PAGE_EXECUTE_READWRITE = 0x40

/**
 * Resume a thread fully — mirrors the C# `while (ResumeThread > 1)` pattern.
 * @param {BigInt} threadHandle
 */
function resumeThreadFully(threadHandle) {
  let count
  do {
    count = addon.resumeThread(threadHandle)
  } while (count > 1)
}

module.exports = {
  ...addon,
  PROCESS_VM_READ,
  PROCESS_VM_WRITE,
  PROCESS_VM_OPERATION,
  PROCESS_QUERY_INFORMATION,
  PROCESS_ALL_ACCESS,
  MEM_COMMIT,
  MEM_RESERVE,
  PAGE_READWRITE,
  PAGE_EXECUTE_READ,
  PAGE_EXECUTE_READWRITE,
  resumeThreadFully
}
