import { useEffect, useState } from 'react'

// Probe the .NET runtime + SDK once on mount and expose the result for the
// runtime/SDK chip (runtimeChip). The answer can't change without an app
// restart, so a single mount-time probe is enough. Shared by the server and
// client panels, which both derive a chip from this via runtimeChip().
export function useDotnetRuntime() {
  const [runtime, setRuntime] = useState({ dotnetFound: null, netCoreApp10: null, sdk10: null })
  useEffect(() => {
    window.sparkAPI
      .checkDotnetRuntime()
      .then(setRuntime)
      .catch((err) => console.error('[runtime] checkDotnetRuntime failed:', err))
  }, [])
  return runtime
}
