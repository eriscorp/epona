import { killProcessTree } from './processKill.js'

// Server-instance lifecycle helpers, factored out of index.js so they can be
// unit-tested without an Electron/ipcMain harness. The stateful dependencies
// (settingsManager, the instanceChildren map, wireInstanceLogs, launchServer)
// are injected via createInstanceManager. The rest are pure, except stopChild,
// which signals processes through processKill.js.

// Strip the non-serialisable child/cleanup fields off a launch result before
// it crosses the IPC boundary.
export function toSafeResult(result) {
  const { child: _child, cleanup: _cleanup, ...safe } = result
  return safe
}

// Is a tracked entry still alive? Child entries are alive until their process
// exits; pid (console-wrapper) entries are assumed alive while tracked.
export function isTrackedAlive(tracked) {
  return tracked.kind === 'child' ? tracked.value.exitCode === null : true
}

// How long to wait for a child's 'exit' after its tree is gone. Node reaps the
// child on the next turns of the event loop, so this is a cap, not a delay.
const EXIT_EVENT_WAIT_MS = 1000

// End a child's process tree and wait for the child's 'exit', so the exit
// handler (wireInstanceLogs, wireHybrasylChildLogs) has untracked it when this
// returns. Resolves { ok: true }, or { ok: false, error } when the tree is still
// running: the caller then must not run the launch's cleanup, because on macOS
// and Linux nothing stops `git worktree remove` under a live server (HTOO-592).
// Used by Stop, Reset, the quit sweep and the repo-mode client's relaunch.
//
// `child.kill()` sent SIGTERM to `dotnet run` only. killProcessTree signals the
// child's process group (spawnDirect's `detached: true`) and waits for all of it.
export async function stopChild(child, options) {
  if (child.exitCode !== null || child.signalCode != null || child.pid === undefined) {
    return { ok: true }
  }
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const result = await killProcessTree(child.pid, options)
  if (result.ok) await Promise.race([exited, new Promise((r) => setTimeout(r, EXIT_EVENT_WAIT_MS))])
  return result
}

// A launch's cleanup, safe to call from more than one place. A server child's
// exit, Stop and Reset can each reach it (HTOO-641): the first call runs it, and
// each later call gets the same promise, so it runs once and every caller can
// still await it. Reset awaits it before the relaunch, because the cleanup
// releases the worktree and the build-props claim that the relaunch takes.
export function runOnce(fn) {
  let pending = null
  return () => (pending ??= Promise.resolve().then(fn))
}

// Resolve an instance's worldDirectoryId to a concrete dataDir path that
// serverTarget understands. Returns null if the world directory is missing
// (deleted out from under the instance, or never set).
export function resolveInstanceForLaunch(settings, instance) {
  const wd = settings.worldDirectories.find((w) => w.id === instance.worldDirectoryId)
  if (!wd) return null
  return { ...instance, dataDir: wd.path }
}

export function createInstanceManager({
  settingsManager,
  instanceChildren,
  wireInstanceLogs,
  launchServer
}) {
  // Validate the payload, re-resolve the instance from disk by id (spawn-path
  // hardening: the renderer can't supply forged paths), and attach its world
  // dir. Returns { instance } on success or { error } for the handler.
  async function resolveSuppliedInstance(supplied) {
    if (!supplied || typeof supplied.id !== 'string') {
      return { error: 'invalid instance payload' }
    }
    const settings = await settingsManager.load()
    const persisted = settings.instances.find((i) => i.id === supplied.id)
    if (!persisted) {
      return { error: 'instance not in saved settings — save changes first' }
    }
    const instance = resolveInstanceForLaunch(settings, persisted)
    if (!instance) {
      return { error: 'World directory not selected for this instance — pick one in settings.' }
    }
    return { instance }
  }

  // Launch a server instance, track its child/pid in instanceChildren, and
  // return the IPC-safe response. Shared by instance:start and instance:reset.
  async function spawnAndTrackInstance(instance) {
    const result = await launchServer(instance)
    const cleanup = runOnce(result.cleanup ?? (async () => {}))
    if (result.success && result.child) {
      instanceChildren.set(instance.id, { kind: 'child', value: result.child, cleanup })
      wireInstanceLogs(instance.id, result.child)
    } else if (result.success && result.pid) {
      instanceChildren.set(instance.id, { kind: 'pid', value: result.pid, cleanup })
    }
    return toSafeResult(result)
  }

  return { resolveSuppliedInstance, spawnAndTrackInstance }
}
