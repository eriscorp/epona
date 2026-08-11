// Pure derivation of "which server instances are running", from three inputs:
// what the launcher tracks, whether those PIDs are still alive, and which lobby
// ports are listening. Kept free of Electron/child_process so the interesting
// rules — adoption, shared-port ambiguity, change detection — are unit-testable.
//
// Why this exists: on Windows a repo/binary server runs inside a PowerShell
// console wrapper, so we hold a wrapper PID rather than a child process object.
// Nothing tells us when that wrapper dies, and nothing told us about a server
// that outlived a previous Epona run. The renderer used to keep its own guess in
// React state, which drifted in both directions.

// Ports claimed by more than one configured instance can't be attributed by a
// probe alone. Returns a Set of those ports.
export function findAmbiguousPorts(instances) {
  const seen = new Map()
  for (const inst of instances ?? []) {
    const port = inst?.lobbyPort
    if (!Number.isInteger(port) || port <= 0) continue
    seen.set(port, (seen.get(port) ?? 0) + 1)
  }
  const ambiguous = new Set()
  for (const [port, count] of seen) if (count > 1) ambiguous.add(port)
  return ambiguous
}

// Is a tracked entry's process still running, and what is its pid?
//
// The single definition of "tracked and alive", because two callers depend on
// it and they MUST agree: buildStatusSnapshot decides whether to believe the
// entry instead of the probe, and portsToProbe decides whether to make that
// probe at all. Two copies of this rule would drift into either a redundant
// probe or a row that reports nothing.
//
// A 'child' entry is a real ChildProcess, so its own exitCode is authoritative.
// A 'pid' entry is a bare wrapper pid we can only ask the OS about, and an
// absent answer means we did not sample it — treat that as alive rather than
// reaping something on missing evidence.
function trackedLiveness(entry, aliveByPid) {
  const pid = entry.kind === 'child' ? entry.value?.pid : entry.value
  const alive =
    entry.kind === 'child' ? entry.value?.exitCode === null : (aliveByPid?.get(pid) ?? true)
  return { pid, alive }
}

// Which lobby ports does this pass actually need to probe?
//
// Every probe is a real TCP connection that Hybrasyl accepts as a client: it
// assigns a connection id, requests an encryption key, queues the CONNECTED
// SERVER packet, reads zero bytes and disconnects — four log lines per probe,
// one of them at error level, every poll interval, forever. So only probe a
// port whose answer can change a row.
//
// Probe when:
//   - no tracked entry exists for the instance. This is the ADOPTION path, and
//     it is the only way Epona sees a server it did not start or one that
//     outlived an earlier run. It must keep working.
//   - a tracked entry exists but its process is dead. The monitor reaps those
//     on the same tick, so this pass is where the fall-back probe has to run;
//     without it a stop Epona did not perform reports late by one interval.
//
// Skip when a live tracked entry already answers for the port, and skip an
// ambiguous port — buildStatusSnapshot refuses to attribute one to an instance,
// so its probe result is discarded either way.
export function portsToProbe({ instances, tracked, aliveByPid }) {
  const ambiguous = findAmbiguousPorts(instances)
  const ports = new Set()
  for (const inst of instances ?? []) {
    const port = inst?.lobbyPort
    if (!port || ambiguous.has(port)) continue
    const entry = tracked?.get(inst.id)
    if (entry && trackedLiveness(entry, aliveByPid).alive) continue
    ports.add(port)
  }
  return [...ports]
}

// Build the authoritative snapshot.
//
//   instances    — settings.instances
//   tracked      — Map<instanceId, { kind, value }> (the launcher's own children)
//   aliveByPid   — Map<pid, boolean> liveness for every tracked pid
//   portsInUse   — Map<port, boolean> from the TCP probe
//
// Each row is { id, running, pid, source, ambiguousPort }:
//   source 'tracked'  — we started it and its process is alive
//   source 'adopted'  — we didn't start it, but its lobby port is listening
//   source null       — not running
export function buildStatusSnapshot({ instances, tracked, aliveByPid, portsInUse }) {
  const ambiguous = findAmbiguousPorts(instances)
  return (instances ?? []).map((inst) => {
    const entry = tracked?.get(inst.id)
    if (entry) {
      const { pid, alive } = trackedLiveness(entry, aliveByPid)
      if (alive) {
        return {
          id: inst.id,
          running: true,
          pid: pid ?? null,
          source: 'tracked',
          ambiguousPort: false
        }
      }
    }
    // Untracked (or tracked-but-dead): fall back to the port probe. A shared
    // lobby port can't be attributed to one instance, so don't guess — report
    // it so the UI can explain why the row looks idle.
    const isAmbiguous = ambiguous.has(inst.lobbyPort)
    const listening = !isAmbiguous && portsInUse?.get(inst.lobbyPort) === true
    return {
      id: inst.id,
      running: listening,
      pid: null,
      source: listening ? 'adopted' : null,
      ambiguousPort: isAmbiguous
    }
  })
}

// Which tracked pid-entries have died? Returns the instance ids to reap. Child
// entries are excluded — their 'exit' event already drives cleanup.
export function findDeadTracked(tracked, aliveByPid) {
  const dead = []
  for (const [id, entry] of tracked ?? []) {
    if (entry.kind !== 'pid') continue
    if (aliveByPid?.get(entry.value) === false) dead.push(id)
  }
  return dead
}

// Has the snapshot changed? Keeps the poller from pushing an identical payload
// to the renderer every few seconds.
export function statusChanged(prev, next) {
  if (!prev || prev.length !== next.length) return true
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (
      a.id !== b.id ||
      a.running !== b.running ||
      a.pid !== b.pid ||
      a.source !== b.source ||
      a.ambiguousPort !== b.ambiguousPort
    ) {
      return true
    }
  }
  return false
}
