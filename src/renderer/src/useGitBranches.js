import { useState } from 'react'

// Branch-list cache shared by the server and client panels. Keyed by repo path
// so switching instances / flipping modes doesn't refetch every time.
// { [repoPath]: { branches, error, loading } | undefined }
export function useGitBranches() {
  const [branchCache, setBranchCache] = useState({})

  // Refetch branches for a repo path. Marks the entry loading so the UI can
  // show a spinner and avoid mislabeling missing branches as "(loading…)".
  function refreshBranches(p) {
    if (!p) return
    setBranchCache((prev) => ({
      ...prev,
      [p]: { branches: prev[p]?.branches ?? [], error: null, loading: true }
    }))
    window.sparkAPI.listGitBranches(p).then((result) => {
      setBranchCache((prev) => ({
        ...prev,
        [p]: result.ok
          ? { branches: result.branches, error: null, loading: false }
          : { branches: [], error: result.error, loading: false }
      }))
    })
  }

  return { branchCache, setBranchCache, refreshBranches }
}

// Pin a saved branch into the option list even if it's not in the fetched
// results — covers the loading window before the IPC returns, the branch
// having been deleted, and a git error suppressing the listing entirely.
// `loading` distinguishes the in-flight case (label "(loading…)") from the
// completed-but-not-found case (label "(missing)").
export function withSavedBranchPinned(branches, savedName, loading) {
  if (!savedName || branches.some((b) => b.name === savedName)) return branches
  return [
    { name: savedName, current: false, remote: false, missing: true, loading: !!loading },
    ...branches
  ]
}
