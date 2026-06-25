import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

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

// Test seam: drop the memoized result so a test can re-probe.
export function _resetDotnetPathCache() {
  cached = undefined
}
