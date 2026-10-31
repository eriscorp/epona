import { execFile, spawn } from 'child_process'

// How long a process tree gets to exit after SIGTERM before SIGKILL. The
// server's own shutdown sleeps 2 s (server hybrasyl/Game.cs), so this leaves it
// room. Stop, Reset and the quit sweep all use it (HTOO-592).
export const STOP_GRACE_MS = 5000
// How long to wait for the tree to go after SIGKILL before reporting failure.
const KILL_WAIT_MS = 2000
const POLL_MS = 100

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

// Signal 0 tests for existence. EPERM means it exists and belongs to another user.
function exists(target) {
  try {
    process.kill(target, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

// The process group of each PID, from `ps`. A PID that `ps` does not list (it
// exited, or `ps` failed) has no entry.
function processGroups(pids) {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'pid=,pgid=', '-p', pids.join(',')], (_err, stdout) => {
      const groups = new Map()
      for (const line of String(stdout ?? '').split('\n')) {
        const [pid, pgid] = line.trim().split(/\s+/).map(Number)
        if (pid > 0 && pgid > 0) groups.set(pid, pgid)
      }
      resolve(groups)
    })
  })
}

async function gone(target, ms) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (!exists(target)) return true
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  return !exists(target)
}

// Signal the process group that `pid` is in, not the group numbered `pid`.
// spawnDirect's server leads its own group (detached:true), but the listener
// that findPortOwner finds for an adopted `dotnet run` server is the apphost,
// a child in the muxer's group: signalling `-pid` found no group, failed with
// ESRCH, and reported success while the server ran on (HTOO-642). Epona's own
// group is never a target, so a child spawned without `detached` gets a signal
// to its PID only.
//
// SIGTERM first, and SIGKILL only when the group outlives the grace period
// (HTOO-592). The wait is for the whole group: `dotnet run` exits on SIGTERM
// within milliseconds, while the server it started is still shutting down and
// still holds its files and ports.
async function killPosixTree(pid, { graceMs = STOP_GRACE_MS } = {}) {
  const groups = await processGroups([pid, process.pid])
  const pgid = groups.get(pid)
  const target = pgid > 1 && pgid !== groups.get(process.pid) ? -pgid : pid
  // ESRCH is "already gone" only when the PID itself is gone too.
  if (!exists(target) && !exists(pid)) return { ok: true }
  for (const [signal, wait] of [
    ['SIGTERM', graceMs],
    ['SIGKILL', KILL_WAIT_MS]
  ]) {
    try {
      process.kill(target, signal)
    } catch (err) {
      if (err.code !== 'ESRCH') return { ok: false, error: err }
    }
    if (await gone(target, wait)) return { ok: true }
  }
  return { ok: false, error: new Error(`process ${pid} is still running after SIGKILL`) }
}

// Ends a process and its tree, and resolves when it is gone: { ok: true }, or
// { ok: false, error } when it could not be ended. On Windows, `taskkill /F /T`
// at once: the console wrapper's Read-Host must not veto it.
export function killProcessTree(pid, options) {
  return process.platform === 'win32' ? killWindowsTree(pid) : killPosixTree(pid, options)
}
