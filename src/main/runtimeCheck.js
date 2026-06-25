import { execFile } from 'child_process'
import { promisify } from 'util'
import { resolveDotnetPath } from './dotnet.js'

const execFileAsync = promisify(execFile)

// Parse the output of `dotnet --list-runtimes`.
// Each line looks like: "Microsoft.NETCore.App 10.0.0 [C:\\Program Files\\dotnet\\shared\\...]"
// Returns a list of { name, version } (path ignored).
export function parseListRuntimesOutput(stdout) {
  const runtimes = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    const match = line.match(/^(\S+)\s+(\d+\.\d+\.\d+\S*)/)
    if (!match) continue
    runtimes.push({ name: match[1], version: match[2] })
  }
  return runtimes
}

// Parse the output of `dotnet --list-sdks`.
// Each line looks like: "10.0.100 [C:\\Program Files\\dotnet\\sdk]"
// Returns a list of { version }. The SDK has no name discriminant (unlike
// runtimes, which split into NETCore/AspNetCore/WindowsDesktop), so the
// shape is intentionally smaller than the runtime parser's.
export function parseListSdksOutput(stdout) {
  const sdks = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    // SDK lines start with the version, NOT a package name — distinguishes
    // them from runtime lines if a caller ever feeds the wrong output in.
    const match = line.match(/^(\d+\.\d+\.\d+\S*)\s+\[/)
    if (!match) continue
    sdks.push({ version: match[1] })
  }
  return sdks
}

export function hasRuntime(runtimes, name, majorVersion) {
  return runtimes.some(
    (r) => r.name === name && parseInt(r.version.split('.')[0], 10) === majorVersion
  )
}

export function hasSdk(sdks, majorVersion) {
  return sdks.some((s) => parseInt(s.version.split('.')[0], 10) === majorVersion)
}

// Side-effectful: shell out to `dotnet --list-runtimes` and `--list-sdks` in
// parallel. Returns { dotnetFound, netCoreApp10, sdk10, runtimes, sdks }.
// dotnetFound=false if the `dotnet` binary is missing or any call fails.
//
// Why probe both: binary-mode launches against a self-contained .dll/.exe
// need only the runtime, but repo-mode `dotnet run` invokes the build first
// and needs the SDK. Showing only runtime status was misleading users into
// a "✓ runtime detected, but my build still fails" loop.
export async function checkDotnetRuntime() {
  try {
    const dotnet = await resolveDotnetPath()
    const [{ stdout: rtOut }, { stdout: sdkOut }] = await Promise.all([
      execFileAsync(dotnet, ['--list-runtimes']),
      execFileAsync(dotnet, ['--list-sdks'])
    ])
    const runtimes = parseListRuntimesOutput(rtOut)
    const sdks = parseListSdksOutput(sdkOut)
    return {
      dotnetFound: true,
      netCoreApp10: hasRuntime(runtimes, 'Microsoft.NETCore.App', 10),
      sdk10: hasSdk(sdks, 10),
      runtimes,
      sdks
    }
  } catch {
    return {
      dotnetFound: false,
      netCoreApp10: false,
      sdk10: false,
      runtimes: [],
      sdks: []
    }
  }
}
