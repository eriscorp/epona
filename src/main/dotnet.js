import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import { homedir } from 'os'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// Resolve a usable `dotnet` executable path.
//
// GUI apps launched from Finder/Dock (macOS) or a desktop launcher (Linux)
// don't inherit the shell PATH, so a bare `dotnet` fails to resolve even when
// .NET is installed — the official installer lives in /usr/local/share/dotnet
// (macOS), outside the default GUI PATH. That made checkDotnetRuntime report
// ".NET not installed" and would equally break `dotnet run` / `dotnet <dll>`
// launches from a packaged build. Probe DOTNET_ROOT and the common install
// locations and return an explicit path; fall back to 'dotnet' so PATH-based
// resolution still works on Windows and for terminal-launched dev runs.

let cached

function candidatePaths() {
  const exe = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet'
  const paths = []
  if (process.env.DOTNET_ROOT) paths.push(join(process.env.DOTNET_ROOT, exe))
  if (process.platform === 'win32') {
    if (process.env.ProgramFiles) paths.push(join(process.env.ProgramFiles, 'dotnet', exe))
  } else if (process.platform === 'darwin') {
    paths.push('/usr/local/share/dotnet/dotnet')
    paths.push('/opt/homebrew/bin/dotnet')
    paths.push('/usr/local/bin/dotnet')
    paths.push(join(homedir(), '.dotnet', 'dotnet'))
  } else {
    paths.push('/usr/bin/dotnet')
    paths.push('/usr/lib/dotnet/dotnet')
    paths.push('/usr/share/dotnet/dotnet')
    paths.push('/snap/bin/dotnet')
    paths.push(join(homedir(), '.dotnet', 'dotnet'))
  }
  return paths
}

async function isFile(p) {
  try {
    return (await fs.stat(p)).isFile()
  } catch {
    return false
  }
}

export async function resolveDotnetPath() {
  if (cached) return cached
  for (const p of candidatePaths()) {
    if (await isFile(p)) {
      cached = p
      return cached
    }
  }
  // PATH fallback — correct on Windows and when launched from a terminal that
  // has dotnet on PATH. If it's genuinely absent, the spawn/probe fails the
  // same way it did before.
  cached = 'dotnet'
  return cached
}

// The runtime root from `dotnet --list-runtimes`: two folders above the path on
// a Microsoft.NETCore.App line, .NET 10 first. With Homebrew's `dotnet` formula
// that is `…/libexec`. The formula's `bin/dotnet` is a script that sets
// DOTNET_ROOT and runs `libexec/dotnet`, so the folder of `realpath(dotnet)` is
// `bin`, and an apphost given that root still finds no runtime (M4, HTOO-645).
export function runtimeRootFromListRuntimes(stdout) {
  const roots = []
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    const m = line.trim().match(/^Microsoft\.NETCore\.App (\d+)\.\S+ \[(.+)\]$/)
    if (m) roots.push({ major: Number(m[1]), root: dirname(dirname(m[2])) })
  }
  return (roots.find((r) => r.major === 10) ?? roots[0])?.root ?? null
}

let cachedRoot

// DOTNET_ROOT for an apphost that Epona starts directly, off Windows. An
// apphost finds its runtime through DOTNET_ROOT or the global install location,
// and Homebrew's formula writes no install location. Finder and the Dock give
// Epona no shell profile, so a framework-dependent client in binary mode exited
// with "You must install .NET to run this application" (HTOO-645). Returns {}
// on Windows, when DOTNET_ROOT is set already, and when `dotnet` was not found
// at an absolute path.
export async function dotnetRootEnv() {
  if (process.platform === 'win32' || process.env.DOTNET_ROOT) return {}
  if (cachedRoot === undefined) {
    cachedRoot = null
    const dotnet = await resolveDotnetPath()
    if (isAbsolute(dotnet)) {
      try {
        const { stdout } = await execFileAsync(dotnet, ['--list-runtimes'])
        cachedRoot = runtimeRootFromListRuntimes(stdout)
      } catch {
        /* no runtime list: the apphost reports its own error */
      }
    }
  }
  return cachedRoot ? { DOTNET_ROOT: cachedRoot } : {}
}

// Test seam: drop the memoized result so a test can re-probe.
export function _resetDotnetPathCache() {
  cached = undefined
  cachedRoot = undefined
}
