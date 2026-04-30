import { spawn } from 'child_process'

function killWindowsTree(pid) {
  return new Promise((resolve) => {
    const tk = spawn('taskkill.exe', ['/F', '/T', '/PID', String(pid)], {
      stdio: 'ignore',
      windowsHide: true
    })
    tk.once('exit', () => resolve({ ok: true }))
    tk.once('error', (err) => resolve({ ok: false, error: err }))
  })
}

// Negative pid → SIGKILL the whole process group, which only works because
// serverTarget spawns its non-Windows child with detached:true (making it
// the pgid leader). ESRCH means the group already exited.
function killPosixTree(pid) {
  try {
    process.kill(-pid, 'SIGKILL')
    return Promise.resolve({ ok: true })
  } catch (err) {
    if (err.code === 'ESRCH') return Promise.resolve({ ok: true })
    return Promise.resolve({ ok: false, error: err })
  }
}

export function killProcessTree(pid) {
  return process.platform === 'win32' ? killWindowsTree(pid) : killPosixTree(pid)
}
