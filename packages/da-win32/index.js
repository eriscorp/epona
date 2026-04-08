const addon = require('./build/Release/da_win32.node')

// Win32 process access flags
const PROCESS_VM_READ = 0x0010
const PROCESS_VM_WRITE = 0x0020
const PROCESS_VM_OPERATION = 0x0008
const PROCESS_ALL_ACCESS = 0x001f0fff

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
  PROCESS_ALL_ACCESS,
  resumeThreadFully
}
