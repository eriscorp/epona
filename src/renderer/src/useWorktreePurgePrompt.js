import { useState } from 'react'

// Ask about the worktree a branch switch just abandoned.
//
// Repo-mode launches give each pinned branch its own git worktree under
// <repo>/.worktrees. Switching an instance (or the client target) to a different
// branch used to leave the old one on disk indefinitely: refcounts only exist
// while something is running, so nothing ever released it. The startup/quit
// sweeps now collect those, but sweeping happens later and silently — offer the
// choice at the moment the user makes it.
//
// Usage: call `check(oldBranch, { running })` right after persisting a branch
// change. Render `<WorktreePurgeDialog {...dialogProps} />` (see the `pending`
// value) and the hook drives the rest.

// Pure: which managed worktree does this branch own, if any? Exported for tests.
export function findWorktreeForBranch(managed, branch) {
  if (typeof branch !== 'string' || branch.length === 0) return null
  return (managed ?? []).find((w) => w.branch === branch) ?? null
}

export function useWorktreePurgePrompt(onResult) {
  // { repo, branch, path, dirty, refcount } while the dialog is open.
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)

  // Returns nothing; opens the dialog when there is something to ask about.
  async function check(oldBranch, { running = false } = {}) {
    // Nothing to release: no pinned branch before, or the launch that owns the
    // worktree is still running (stopping it releases the worktree anyway).
    if (typeof oldBranch !== 'string' || oldBranch.length === 0 || running) return
    try {
      const managed = await window.sparkAPI.listManagedWorktrees()
      const match = findWorktreeForBranch(managed, oldBranch)
      if (!match || match.refcount > 0) return
      setPending(match)
    } catch {
      // Listing is best-effort — the sweeps still catch this worktree later.
    }
  }

  async function confirm() {
    if (!pending) return
    setBusy(true)
    // A dirty worktree only gets removed because the dialog said so explicitly.
    const result = await window.sparkAPI.removeWorktree(pending.repo, pending.branch, pending.dirty)
    setBusy(false)
    setPending(null)
    if (result?.ok) {
      onResult?.({ severity: 'success', message: `Removed worktree for "${pending.branch}"` })
    } else {
      onResult?.({
        severity: 'error',
        message: `Couldn't remove the worktree for "${pending.branch}"${
          result?.error ? `: ${result.error}` : ` (${result?.reason ?? 'unknown'})`
        }`
      })
    }
  }

  return { pending, busy, check, confirm, dismiss: () => setPending(null) }
}
