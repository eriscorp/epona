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
