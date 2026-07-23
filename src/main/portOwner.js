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
  return parseLsofOwner(
    await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], timeoutMs)
  )
}
