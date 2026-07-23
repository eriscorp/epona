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

// Every branch some saved config still points at. The orphan sweep keeps these
// and removes the rest, so switching an instance's branch doesn't leave the old
// branch's worktree on disk forever.
//
// Branch fields carry three meanings: a name (pinned branch), `null` ("use the
// current checkout" / NuGet XML), and `''` (local XML, in place). Only a real
// name owns a worktree, so the empty cases are skipped.
//
// Returns a flat Set of names rather than a per-repo map: two repos never share
// a `.worktrees` dir, and keeping a branch that a *different* repo references is
// the safe direction to err in.
export function collectReferencedBranches(settings) {
  const branches = new Set()
  const add = (b) => {
    if (typeof b === 'string' && b.length > 0) branches.add(b)
  }
  add(settings?.targets?.hybrasyl?.clientBranch)
  for (const inst of settings?.instances ?? []) {
    add(inst.serverBranch)
    add(inst.xmlBranch)
  }
  return branches
}
