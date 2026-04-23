import { execFile } from 'child_process'
import { promisify } from 'util'

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

export function hasRuntime(runtimes, name, majorVersion) {
  return runtimes.some(
    (r) => r.name === name && parseInt(r.version.split('.')[0], 10) === majorVersion
  )
}

// Side-effectful: shell out to `dotnet --list-runtimes`.
// Returns { dotnetFound, netCoreApp10, runtimes }.
// dotnetFound=false if the `dotnet` binary is missing or the call fails.
export async function checkDotnetRuntime() {
  try {
    const { stdout } = await execFileAsync('dotnet', ['--list-runtimes'])
    const runtimes = parseListRuntimesOutput(stdout)
    return {
      dotnetFound: true,
      netCoreApp10: hasRuntime(runtimes, 'Microsoft.NETCore.App', 10),
      runtimes
    }
  } catch {
    return { dotnetFound: false, netCoreApp10: false, runtimes: [] }
  }
}
