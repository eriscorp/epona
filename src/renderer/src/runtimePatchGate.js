// Which client build is actually going to be launched, and does it support a
// given hook-based runtime patch?
//
// Most Legacy options poke a couple of bytes at an address every supported
// version has. The hook patches (ground-item hints) install whole stubs, and
// their prologues, helper functions and vtables were only ever mapped for one
// build — so the option has to disappear rather than mislead on the others.

// The version that will be used at launch: the explicit choice, or whatever the
// exe hashed to when the setting is 'auto'. Returns null when nothing is known
// yet (no client path picked, or an unrecognised exe).
export function resolveVersionCode(versionSetting, detectedVersionCode) {
  if (versionSetting === 'auto' || versionSetting === undefined || versionSetting === null) {
    return detectedVersionCode ?? null
  }
  const code = Number(versionSetting)
  return Number.isFinite(code) ? code : null
}

// Does the resolved version advertise this patch? `versions` is the list from
// listVersions(), each entry carrying its own runtimePatches array — so adding a
// patch to another build later needs no change here.
export function supportsPatch(versions, versionCode, patch) {
  if (versionCode === null) return false
  const entry = (versions ?? []).find((v) => v.versionCode === versionCode)
  return Boolean(entry?.runtimePatches?.includes(patch))
}
