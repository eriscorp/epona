// Build the runtime/SDK chip { label, color } from probed .NET state. Repo
// (source / dotnet-run) launches need both runtime AND SDK; binary launches
// only need the runtime. `needsSdk` selects between the two shapes so the user
// can tell which install they're missing at a glance. The server always needs
// the SDK (repo-mode `dotnet run`); the client only when in repo mode.
export function runtimeChip(runtime, { needsSdk }) {
  const runtimeOk = runtime.netCoreApp10 === true && (!needsSdk || runtime.sdk10 === true)
  if (runtime.dotnetFound === null) return { label: 'Checking .NET…', color: 'default' }
  if (!runtime.dotnetFound) return { label: '.NET not installed', color: 'error' }
  if (runtimeOk) {
    return needsSdk
      ? { label: '.NET 10 runtime + SDK', color: 'success' }
      : { label: '.NET 10 runtime', color: 'success' }
  }
  if (needsSdk && !runtime.sdk10 && runtime.netCoreApp10) {
    return { label: '.NET 10 SDK missing', color: 'warning' }
  }
  if (needsSdk && !runtime.sdk10 && !runtime.netCoreApp10) {
    return { label: '.NET 10 runtime + SDK missing', color: 'warning' }
  }
  return { label: '.NET 10 runtime missing', color: 'warning' }
}
