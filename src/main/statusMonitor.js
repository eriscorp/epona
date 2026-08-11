import {
  buildStatusSnapshot,
  findDeadTracked,
  portsToProbe,
  statusChanged
} from './instanceStatus.js'

// How often to re-derive server status. Fast enough that closing a server's
// console window updates the button before the user reaches for it.
//
// The probe is NOT free, which is why portsToProbe exists: a server Epona
// started and tracks answers for itself, and connecting to it anyway wrote four
// log lines into that server every interval for as long as the app was open.
// The interval is only affordable because a steady state now probes nothing.
export const POLL_INTERVAL_MS = 3000

// Polls the truth about running server instances and pushes it at the renderer.
// All the stateful/impure dependencies are injected so the loop can be driven by
// fake timers in tests; the derivation itself lives in instanceStatus.js.
//
//   settingsManager   — { load() }
//   instanceChildren  — the launcher's Map<instanceId, { kind, value, cleanup }>
//   isPortInUse       — (host, port, timeoutMs) => Promise<boolean>
//   isProcessAlive    — (pid) => boolean
//   onStatus          — (snapshot) => void, called only when the snapshot changes
//   onReap            — async (instanceId, entry) => void, for pid entries whose
//                       process is gone (release worktrees, notify the renderer)
export function createStatusMonitor({
  settingsManager,
  instanceChildren,
  isPortInUse,
  isProcessAlive,
  onStatus,
  onReap,
  intervalMs = POLL_INTERVAL_MS,
  probeTimeoutMs = 500
}) {
  let timer = null
  let inFlight = false
  let last = null

  async function tick() {
    // One pass at a time: a slow probe round must not stack up behind itself.
    if (inFlight) return last
    inFlight = true
    try {
      const settings = await settingsManager.load()
      const instances = settings?.instances ?? []

      // 1. Liveness for every tracked pid entry.
      const aliveByPid = new Map()
      for (const entry of instanceChildren.values()) {
        if (entry.kind === 'pid') aliveByPid.set(entry.value, isProcessAlive(entry.value))
      }

      // 2. Reap the dead ones. This is also the only path that releases the
      //    worktree of a server whose console window the user simply closed.
      for (const id of findDeadTracked(instanceChildren, aliveByPid)) {
        const entry = instanceChildren.get(id)
        instanceChildren.delete(id)
        try {
          await onReap?.(id, entry)
        } catch (err) {
          console.warn(`instance ${id} reap failed:`, err.message)
        }
      }

      // 3. Probe each lobby port whose answer can still change a row, once, in
      //    parallel. This runs AFTER the reap above on purpose: step 2 drops the
      //    entry for a process that died, so this pass sees the instance as
      //    untracked and probes it rather than reporting it late.
      const ports = portsToProbe({ instances, tracked: instanceChildren, aliveByPid })
      const probes = await Promise.all(
        ports.map((p) =>
          Promise.resolve(isPortInUse('127.0.0.1', p, probeTimeoutMs))
            .catch(() => false)
            .then((inUse) => [p, inUse === true])
        )
      )

      const snapshot = buildStatusSnapshot({
        instances,
        tracked: instanceChildren,
        aliveByPid,
        portsInUse: new Map(probes)
      })
      if (statusChanged(last, snapshot)) {
        last = snapshot
        onStatus?.(snapshot)
      } else {
        last = snapshot
      }
      return snapshot
    } catch (err) {
      console.warn('instance status poll failed:', err.message)
      return last
    } finally {
      inFlight = false
    }
  }

  return {
    start() {
      if (timer) return
      timer = setInterval(() => void tick(), intervalMs)
      // Don't hold the event loop open on quit.
      timer.unref?.()
      void tick()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    // Force a pass and return its snapshot — used by the instance:getStatus
    // handler so a freshly mounted renderer doesn't wait for the next tick.
    refresh: tick,
    // Last computed snapshot ([] before the first pass completes).
    current: () => last ?? []
  }
}
