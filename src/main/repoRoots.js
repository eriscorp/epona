import { dirname } from 'path'

// Collect every configured repo path that may carry a `.worktrees` directory:
// the hybrasyl client target's csproj (→ its containing dir) and each server
// instance's server/xml repo paths. Pure and settings-shaped so the
// `worktrees:flush` handler stays a thin await-load → gather → resolve-toplevel
// → flush wiring. (A missing `await` on settingsManager.load() previously left
// `settings` a Promise, so this gather produced nothing and the Flush Worktrees
// button silently no-oped — hence the direct unit coverage here.)
export function collectConfiguredRepoPaths(settings) {
  const paths = []
  const clientRepo = settings?.targets?.hybrasyl?.clientRepoPath
  if (clientRepo) paths.push(dirname(clientRepo))
  for (const inst of settings?.instances ?? []) {
    if (inst.serverRepoPath) paths.push(inst.serverRepoPath)
    if (inst.xmlRepoPath) paths.push(inst.xmlRepoPath)
  }
  return paths
}
