// Returns true iff the user has a usable Hybrasyl client path saved for the
// current mode. Field name varies by mode (binaryPath vs clientRepoPath), so
// callers shouldn't reach in directly — go through this helper. The gate is
// extracted into its own module solely so it can be unit-tested without
// standing up a full renderer test harness.
export function hybrasylClientPathConfigured(settings) {
  const hyb = settings?.targets?.hybrasyl
  const active = hyb?.mode === 'repo' ? hyb?.clientRepoPath : hyb?.binaryPath
  return Boolean(active)
}

// Whether Launch should ask first, given the Dark Ages folder check
// (inspectAssetDir). Off Windows the Hybrasyl client gets the folder as
// DA_ASSET_PATH. When the folder exists and holds no .dat files, Brigid falls
// back to the asset folder saved in its own config and starts with no error, so
// the user cannot tell which assets it uses (HTOO-669). Epona warns and does
// not refuse: the fallback is a valid way to run. An empty or missing folder is
// main's "Dark Ages folder not set" error (HTOO-656), and on Windows clientPath
// is the legacy client's .exe, so neither asks.
export function hybrasylAssetWarning(targetKind, platform, assetCheck) {
  return targetKind === 'hybrasyl' && platform !== 'win32' && assetCheck?.reason === 'no-dat-files'
}
