import { useEffect } from 'react'
import { useRuntime } from './store/runtimeStore.js'

// The Dark Ages folder check (main's inspectAssetDir), shared through the
// runtime store by the Legacy tab's chip and the nav toolbar. The toolbar said
// "Assets: <folder>" for any path that was set, while the Legacy tab could say
// "Not found" for the same path (HTOO-660). Each caller asks again when the path
// changes; the store keeps the newest answer with the path it is for, so a
// caller never shows the answer for another path.
//
// @param {string} clientPath
// @param {boolean} [enabled] false skips the check (Windows, where clientPath
//   is the legacy client's .exe)
// @returns {object|null} inspectAssetDir's result, or null until it is known
export function useAssetDirStatus(clientPath, enabled = true) {
  const entry = useRuntime((s) => s.assetDir)
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    window.sparkAPI.inspectAssetDir(clientPath).then((result) => {
      if (!cancelled) useRuntime.getState().setAssetDir(clientPath, result)
    })
    return () => {
      cancelled = true
    }
  }, [clientPath, enabled])
  return entry && entry.path === clientPath ? entry.result : null
}
