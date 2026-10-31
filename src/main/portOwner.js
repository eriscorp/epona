import { execFile } from 'child_process'

// Which process owns a local listening port? Used only for the "adopted"
// instances the status monitor discovers by port probe — a server left behind by
// an earlier Epona run (or started by hand) has no tracked child, so Stop needs
// a PID from somewhere. Best-effort: a null result just means Stop can't be
// offered for that row.

// Pure parser for `netstat -ano -p tcp`. One listening row looks like:
//
//   Proto  Local Address      Foreign Address    State       PID
//   TCP    0.0.0.0:2610       0.0.0.0:0          LISTENING   1234
//   TCP    [::]:2610          [::]:0             LISTENING   1234
//
// The State column is localized on non-English Windows, so don't require the
// literal "LISTENING": a wildcard foreign address identifies a listener in any
// locale. Returns the first matching PID, or null.
export function parseNetstatOwner(stdout, port) {
  const wanted = `:${port}`
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 4) continue
    const [proto, local, foreign, ...rest] = cols
    if (!/^TCP$/i.test(proto)) continue
    if (!local.endsWith(wanted)) continue
    const isListener = foreign === '0.0.0.0:0' || foreign === '[::]:0' || /LISTENING/i.test(line)
    if (!isListener) continue
    const pid = Number.parseInt(rest[rest.length - 1], 10)
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

// Pure parser for `lsof -t` output (one PID per line). Returns the first, or null.
export function parseLsofOwner(stdout) {
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const pid = Number.parseInt(line.trim(), 10)
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

// Pure parser for `ss -Hltnp 'sport = :<port>'` output, one listener per line:
//
//   LISTEN 0 512 0.0.0.0:2610 0.0.0.0:* users:(("Hybrasyl",pid=5954,fd=200))
//
// `ss` names the process only for the user's own processes, which a server that
// Epona or the user started is. Returns the first PID, or null.
export function parseSsOwner(stdout) {
  const m = String(stdout ?? '').match(/\bpid=(\d+)/)
  const pid = m ? Number.parseInt(m[1], 10) : NaN
  return Number.isInteger(pid) && pid > 0 ? pid : null
}

function run(command, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err && !stdout ? '' : stdout)
    )
  })
}

// Resolve the PID listening on `port`, or null when nothing is found (or the
// lookup tool is missing/slow). Never throws.
export async function findPortOwner(port, timeoutMs = 3000) {
  if (!Number.isInteger(port) || port <= 0) return null
  if (process.platform === 'win32') {
    return parseNetstatOwner(await run('netstat.exe', ['-ano', '-p', 'tcp'], timeoutMs), port)
  }
  // lsof exits non-zero with empty output when nothing matches — treated as null.
  const fromLsof = parseLsofOwner(
    await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], timeoutMs)
  )
  if (fromLsof || process.platform !== 'linux') return fromLsof
  // Arch and a minimal Fedora install no `lsof`; iproute2's `ss` is on every
  // Linux. Without it, an adopted Stop said "Stop it from Task Manager" on
  // Linux (HTOO-596).
  return parseSsOwner(await run('ss', ['-Hltnp', `sport = :${port}`], timeoutMs))
}

// What to tell the user when no lookup names the owner of a port: the tool for
// this OS.
export function stopByHandHint(platform = process.platform) {
  if (platform === 'win32') return 'Stop it from Task Manager.'
  if (platform === 'darwin') return 'Stop it from Activity Monitor, or with `kill`.'
  return 'Stop it with `kill`, or install lsof so that Epona can find it.'
}
