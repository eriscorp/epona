// Server-instance lifecycle helpers, factored out of index.js so they can be
// unit-tested without an Electron/ipcMain harness. The stateful dependencies
// (settingsManager, the instanceChildren map, wireInstanceLogs, launchServer)
// are injected via createInstanceManager; the rest are pure.

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

// Kill a tracked child and wait for it to actually exit, capped by timeoutMs so
// a hung process can't block the caller. Used by instance:stop / instance:reset
// (5s) and the before-quit sweep (2s). wireInstanceLogs handles the map delete +
// childExit emit when the exit fires.
export function raceChildExit(child, timeoutMs) {
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try {
    child.kill()
  } catch {
    /* already gone */
  }
  return Promise.race([exited, new Promise((r) => setTimeout(r, timeoutMs))])
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
    const cleanup = result.cleanup ?? (async () => {})
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
