// The descriptors that a child process gets from Epona (HTOO-661, fault 2).
//
// On Linux, libuv's spawn does not close the parent's descriptors in the child.
// It relies on close-on-exec, and Chromium opens app.asar, icudtl.dat, the V8
// snapshot and the .pak files without it. So each child, and each grandchild,
// keeps those files open. Under the AppImage they are in the FUSE mount: a
// `dotnet build-server` (VBCSCompiler) that the server's `dotnet run` starts
// outlives Epona and keeps the mount up after Epona quits. Measured on Mint,
// 2026-11-02 (L5 in docs/plans/01-macos-linux-deep-dive.md).
//
// Node has no fcntl, so Epona cannot set close-on-exec on Chromium's files. But
// libuv dup2()s each `stdio` entry onto its index in the child. So for each
// descriptor that would leak, the child's stdio array gets /dev/null at that
// index, and the child has /dev/null there, not Epona's file. The child keeps
// its own pid, and spawn reports a missing program or a bad path as before. A
// shell wrapper that closes the descriptors would change both.
//
// macOS is not affected: libuv spawns with POSIX_SPAWN_CLOEXEC_DEFAULT there.
// On Windows a child inherits only handles that are marked inheritable.
//
// execFile cannot take a stdio array. The execFile calls (the dotnet probes,
// ps, ss and lsof) end before Epona does, so they keep the files only while
// they run. Every spawn in src/main passes `stdio: childStdio(...)`;
// childEnv.test.js pins that with a scan of the source.

import { openSync, readdirSync, readFileSync } from 'fs'

/** O_CLOEXEC in the `flags:` line of /proc/<pid>/fdinfo/<fd>, which is octal. */
const O_CLOEXEC = 0o2000000

/**
 * The descriptors above 2 that this process has open without close-on-exec.
 * Empty off Linux, and when /proc cannot be read.
 *
 * @param {object} [deps] For tests.
 * @param {string} [deps.platform]
 * @param {string} [deps.proc] The /proc folder of the process to read; this process by default.
 * @param {(path: string) => string[]} [deps.readdir]
 * @param {(path: string, encoding: 'utf8') => string} [deps.readFile]
 * @returns {number[]} In ascending order.
 */
export function leakedFds({
  platform = process.platform,
  proc = '/proc/self',
  readdir = readdirSync,
  readFile = readFileSync
} = {}) {
  if (platform !== 'linux') return []
  let names
  try {
    names = readdir(`${proc}/fd`)
  } catch {
    return []
  }
  const fds = []
  for (const name of names) {
    const fd = Number(name)
    if (!Number.isInteger(fd) || fd <= 2) continue
    let info
    try {
      info = readFile(`${proc}/fdinfo/${fd}`, 'utf8')
    } catch {
      // Closed after the listing; the listing's own descriptor is one.
      continue
    }
    const flags = /^flags:\s*([0-7]+)$/m.exec(info)
    if (flags && (Number.parseInt(flags[1], 8) & O_CLOEXEC) === 0) fds.push(fd)
  }
  return fds.sort((a, b) => a - b)
}

let devNull = null
function devNullFd() {
  // Node opens it with close-on-exec, so it does not leak itself. One for the
  // life of the process: each child gets a dup2() copy of it.
  if (devNull === null) devNull = openSync('/dev/null', 'r+')
  return devNull
}

/**
 * The `stdio` option for a spawn: `stdio` as given, with /dev/null at each
 * index where the child would inherit one of Epona's leaked descriptors. The
 * same value as `stdio` when nothing leaks, which is always so off Linux.
 *
 * @param {string | Array<string | number | null>} [stdio] As for spawn; spawn's default is 'pipe'.
 * @param {object} [deps] For tests.
 * @param {number[]} [deps.fds] The leaked descriptors; `leakedFds()` by default.
 * @param {() => number} [deps.nullFd] An open /dev/null descriptor.
 * @returns {string | Array<string | number | null>}
 */
export function childStdio(stdio = 'pipe', { fds = leakedFds(), nullFd = devNullFd } = {}) {
  if (fds.length === 0) return stdio
  const given = typeof stdio === 'string' ? [stdio, stdio, stdio] : [...stdio]
  const out = [...given]
  // 'ignore' above 2 leaves the child's descriptor as it is. Only an index
  // that leaks needs an entry, and those get one below.
  while (out.length <= fds[fds.length - 1]) out.push('ignore')
  const target = nullFd()
  for (const fd of fds) if (fd >= given.length) out[fd] = target
  return out
}
