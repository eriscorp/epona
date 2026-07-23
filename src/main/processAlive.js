// Is a process still around? `process.kill(pid, 0)` sends no signal — it only
// runs the permission/existence check and throws on failure. Works on Windows
// too (Node maps signal 0 to an OpenProcess existence probe).
//
// We need this because Windows server instances are tracked by the PowerShell
// console wrapper's PID, not by a child process object: there's no 'exit' event
// to tell us the user closed the console, so the launcher has to ask.
//
// PID reuse is a theoretical false positive here. The window is a whole poll
// interval on a PID the OS just recycled, and the cost is one stale "running"
// row until the next Start/Stop — not worth a handle-based tracker.
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it exists, we just can't signal it (elevated server, say).
    return err?.code === 'EPERM'
  }
}
