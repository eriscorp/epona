import { promises as fs } from 'fs'
import { join, resolve as resolvePath, sep } from 'path'
import { runGit } from './gitExec.js'

// Refcounted git-worktree lifecycle. Two server instances on the same branch
// share one worktree on disk; the worktree is removed when the last instance
// referencing it stops. State lives in memory — on launcher restart, an
// instance asking for a branch that's already on disk adopts the existing
// worktree (refcount = 1), no add attempted.

// repoPath (absolute) → Map<branch → { path, refcount }>
const refcounts = new Map()

// repoPath → Promise — serializes git worktree ops per repo so concurrent
// ensure/release calls don't race the worktree lock.
const mutexes = new Map()

function withMutex(repoPath, fn) {
  const prev = mutexes.get(repoPath) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  mutexes.set(
    repoPath,
    next.catch(() => {})
  )
  return next
}

// runGit is shared from gitExec.js (same spawn scaffold gitOps.js uses). Its
// stdout is trailing-trimmed, which is harmless here — worktree porcelain
// parsing trims per line — and it rejects on non-zero exit exactly as before.

// Branch name → directory-name-safe form. Stable: same branch always maps to
// the same dir. `/` → `__` so feature/foo lands at .worktrees/feature__foo.
// Anything else outside [A-Za-z0-9._-] becomes `_`. Empty input throws —
// callers should never pass null/'' here (they should special-case "use
// current checkout" upstream).
export function sanitizeBranchName(branch) {
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error('sanitizeBranchName: branch must be a non-empty string')
  }
  return branch.replace(/\//g, '__').replace(/[^A-Za-z0-9._-]/g, '_')
}

function worktreePath(repoPath, branch) {
  return resolvePath(repoPath, '.worktrees', sanitizeBranchName(branch))
}

// Canonical absolute form of a repo root. `path.resolve` alone is not enough on
// Windows: it does not expand an 8.3 short name (`C:\Users\RUNNER~1\...`) or
// follow a junction. git always reports the long, fully-resolved form, so a
// repo root in any other form makes every comparison against `git worktree
// list` output miss — the worktree is never adopted, listed or removed.
// Normalizing here keeps both sides of those comparisons in one form, because
// every managed path is built from this root. Falls back to `resolvePath` when
// the path does not exist yet, which is what realpath fails on.
async function realRepoPath(repoPath) {
  const resolved = resolvePath(repoPath)
  try {
    return await fs.realpath(resolved)
  } catch {
    return resolved
  }
}

// Parse `git worktree list --porcelain` into { path → { branch } }. Each
// entry is a paragraph of key/value lines; we only need worktree (path) and
// branch (refs/heads/foo, optional — bare/detached entries omit it).
async function listWorktreesOnDisk(repoPath) {
  const { stdout } = await runGit(repoPath, ['worktree', 'list', '--porcelain'])
  const entries = []
  let current = null
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { path: resolvePath(line.slice('worktree '.length).trim()), branch: null }
    } else if (line.startsWith('branch ')) {
      // 'branch refs/heads/feature/foo' → 'feature/foo'
      const ref = line.slice('branch '.length).trim()
      if (current) current.branch = ref.replace(/^refs\/heads\//, '')
    } else if (line === '') {
      if (current) {
        entries.push(current)
        current = null
      }
    }
  }
  if (current) entries.push(current)
  return entries
}

// Returns the absolute path to a worktree for (repoPath, branch). Creates one
// via `git worktree add` if neither memory nor disk has it; adopts an
// existing on-disk worktree (refcount = 1) on first request after launcher
// restart; bumps refcount on subsequent requests. Always serialized per repo.
export async function ensureWorktree(repoPath, branch) {
  const repo = await realRepoPath(repoPath)
  return withMutex(repo, async () => {
    const branchMap = refcounts.get(repo) ?? new Map()
    // Record (or overwrite) this branch's worktree entry and persist the map.
    const track = (path, refcount) => {
      branchMap.set(branch, { path, refcount })
      refcounts.set(repo, branchMap)
      return path
    }
    const existing = branchMap.get(branch)
    if (existing) {
      return track(existing.path, existing.refcount + 1)
    }

    const target = worktreePath(repo, branch)
    // Is there already a worktree on disk for this (branch or target path)?
    const findAdopted = (list) =>
      list.find((e) => e.branch === branch || resolvePath(e.path) === target)

    // Prune up front — drop any stale admin entries whose working dirs were
    // deleted out from under git (manual `rm`, a crashed run, an interrupted
    // release). Without this, such a dead registration makes the `worktree add`
    // below fail with "already exists" even though nothing is on disk, wedging
    // the launch. Prune only removes entries whose dir is already gone, so it
    // never touches a live worktree or the user's files.
    await runGit(repo, ['worktree', 'prune']).catch(() => {})

    // Adoption check — is there already a worktree on disk for this branch?
    // Two cases land here: (a) Epona was restarted and our in-memory state is
    // empty; (b) a developer made the worktree manually outside Epona.
    let onDisk = await listWorktreesOnDisk(repo)
    let adopted = findAdopted(onDisk)
    if (adopted) return track(adopted.path, 1)

    // Stale-dir recovery — the target path may exist on disk without a
    // matching git registration (failed prior `worktree remove`, manual
    // mucking under `.git/worktrees/`, a crashed `worktree add`, etc.).
    // Without this, the `worktree add` below fails with exit 128 "already
    // exists" and the launch is blocked.
    if (await pathExists(target)) {
      // 1. Prune stale admin entries (idempotent; only removes entries whose
      //    dirs are missing), then retry adoption — common case: prune clears
      //    a broken admin entry that was hiding an otherwise valid worktree.
      await runGit(repo, ['worktree', 'prune']).catch(() => {})
      onDisk = await listWorktreesOnDisk(repo)
      adopted = findAdopted(onDisk)
      if (adopted) return track(adopted.path, 1)

      // 2. If the dir contains a `.git` pointer file, it looks like a real
      //    worktree that lost its admin entry — try `git worktree repair` to
      //    re-link, then re-list and adopt.
      if (await pathExists(join(target, '.git'))) {
        const repaired = await runGit(repo, ['worktree', 'repair', target])
          .then(() => true)
          .catch(() => false)
        if (repaired) {
          onDisk = await listWorktreesOnDisk(repo)
          adopted = findAdopted(onDisk)
          if (adopted) return track(adopted.path, 1)
        }
      }

      // 3. Empty dir → safe to remove and fall through to fresh add.
      const entries = await fs.readdir(target).catch(() => null)
      if (entries && entries.length === 0) {
        await fs.rm(target, { recursive: true, force: true })
      } else {
        // 4. Non-empty dir with no recoverable worktree marker. Could be
        //    user work — refuse to touch it and tell the user where to look.
        throw new Error(
          `Worktree directory exists at ${target} but git doesn't recognize it. ` +
            `Remove it manually if you don't need its contents, then try again.`
        )
      }
    }

    // Fresh add. Ensure parent dir exists — `git worktree add` creates the
    // leaf dir but expects the parent to be there.
    await fs.mkdir(join(repo, '.worktrees'), { recursive: true })
    await runGit(repo, ['worktree', 'add', target, branch])
    return track(target, 1)
  })
}

async function pathExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

// Decrements the refcount; when it hits 0, removes the worktree via git.
// Returns { removed, retained, error } so callers can surface what happened.
// `retained: true` means the worktree had local changes (or removal otherwise
// failed) and was left on disk — the caller can warn the user without
// treating it as a hard failure. We never `--force` by default; force-removing
// a worktree the user has been editing is a bad surprise.
export async function releaseWorktree(repoPath, branch) {
  const repo = await realRepoPath(repoPath)
  return withMutex(repo, async () => {
    const branchMap = refcounts.get(repo)
    const entry = branchMap?.get(branch)
    if (!entry) return { removed: false, retained: false }
    entry.refcount -= 1
    if (entry.refcount > 0) {
      return { removed: false, retained: false }
    }
    branchMap.delete(branch)
    if (branchMap.size === 0) refcounts.delete(repo)
    try {
      await runGit(repo, ['worktree', 'remove', entry.path])
      return { removed: true, retained: false }
    } catch (err) {
      // Most likely cause: the worktree contains uncommitted changes. Leave
      // it alone — the user can clean it up themselves or via the future
      // worktree GC UI.
      return { removed: false, retained: true, error: err.message }
    }
  })
}

// Does a worktree path live under this repo's Epona-managed `.worktrees` dir?
// Everything outside it is the user's own — the main working tree, or a
// worktree they made by hand elsewhere — and we never touch those.
function isManagedPath(repo, p) {
  const wtRoot = resolvePath(repo, '.worktrees')
  return p === wtRoot || p.startsWith(wtRoot + sep)
}

// Does a worktree have uncommitted work in it? Anything we can't answer counts
// as dirty, so an unreadable worktree is never removed by an automatic sweep.
async function isDirty(worktreePath) {
  try {
    const { stdout } = await runGit(worktreePath, ['status', '--porcelain'])
    return stdout.trim().length > 0
  } catch {
    return true
  }
}

// Every Epona-managed worktree in a repo, with the facts a caller needs to
// decide whether removing it is safe: which branch it holds, whether it has
// uncommitted work, and whether a running launch is still using it.
// Returns [{ repo, branch, path, dirty, refcount }].
export async function listManaged(repoPath) {
  const repo = await realRepoPath(repoPath)
  return withMutex(repo, async () => {
    await runGit(repo, ['worktree', 'prune']).catch(() => {})
    const branchMap = refcounts.get(repo)
    const out = []
    for (const entry of await listWorktreesOnDisk(repo)) {
      if (!isManagedPath(repo, entry.path)) continue
      out.push({
        repo,
        branch: entry.branch,
        path: entry.path,
        dirty: await isDirty(entry.path),
        refcount: (entry.branch && branchMap?.get(entry.branch)?.refcount) ?? 0
      })
    }
    return out
  })
}

// Remove one managed worktree by branch. Refuses the two cases where removing
// would lose something: a launch still holds it, or it has uncommitted work and
// the caller hasn't explicitly said to discard that. Returns
// { ok } | { ok: false, reason: 'in-use' | 'dirty' | 'not-found' | 'git', error }.
export async function removeWorktree(repoPath, branch, { force = false } = {}) {
  const repo = await realRepoPath(repoPath)
  return withMutex(repo, async () => {
    const branchMap = refcounts.get(repo)
    const tracked = branchMap?.get(branch)
    if (tracked && tracked.refcount > 0) return { ok: false, reason: 'in-use' }

    await runGit(repo, ['worktree', 'prune']).catch(() => {})
    const onDisk = await listWorktreesOnDisk(repo)
    const entry = onDisk.find((e) => e.branch === branch && isManagedPath(repo, e.path))
    if (!entry) {
      // Nothing on disk — drop any stale bookkeeping and report success-ish.
      branchMap?.delete(branch)
      return { ok: false, reason: 'not-found' }
    }
    if (!force && (await isDirty(entry.path))) return { ok: false, reason: 'dirty' }

    try {
      await runGit(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), entry.path])
      branchMap?.delete(branch)
      if (branchMap && branchMap.size === 0) refcounts.delete(repo)
      return { ok: true, path: entry.path }
    } catch (err) {
      return { ok: false, reason: 'git', error: err.message }
    }
  })
}

// Pure: which of these managed worktrees is safe to sweep automatically?
// An orphan is a worktree no configured instance still points at, that no
// running launch holds, and that has no uncommitted work. Dirty worktrees are
// deliberately kept — the only thing that discards user work is the explicit
// Flush action. `keepBranches` is any iterable of branch names.
export function selectOrphans(managed, keepBranches) {
  const keep = new Set(keepBranches ?? [])
  return (managed ?? []).filter(
    (w) => w.branch && !keep.has(w.branch) && !w.dirty && (w.refcount ?? 0) === 0
  )
}

// Remove every orphan in a repo. Never forces. Returns { repo, removed[], kept[],
// errors[] } so the caller can log what it did without a second listing.
export async function sweepOrphans(repoPath, keepBranches) {
  const managed = await listManaged(repoPath)
  const orphans = selectOrphans(managed, keepBranches)
  const removed = []
  const errors = []
  for (const w of orphans) {
    const r = await removeWorktree(repoPath, w.branch)
    if (r.ok) removed.push(w.path)
    else if (r.reason === 'git') errors.push({ path: w.path, error: r.error })
  }
  return {
    repo: await realRepoPath(repoPath),
    removed,
    kept: managed.filter((w) => !orphans.includes(w)).map((w) => w.path),
    errors
  }
}

// Force-remove every Epona-managed worktree for a repo, then prune git's admin
// entries and drop in-memory refcounts — the manual "unstick me" path behind
// Settings → Flush Worktrees. Unlike releaseWorktree this uses `--force`, so it
// discards uncommitted work in those worktrees; callers must confirm with the
// user first. Only touches worktrees under <repo>/.worktrees — never the main
// working tree or a hand-made worktree elsewhere. Returns { repo, removed[],
// errors[] } so the caller can report what happened.
export async function flushWorktrees(repoPath) {
  const repo = await realRepoPath(repoPath)
  return withMutex(repo, async () => {
    const removed = []
    const errors = []
    const wtRoot = resolvePath(repo, '.worktrees')

    await runGit(repo, ['worktree', 'prune']).catch(() => {})
    const onDisk = await listWorktreesOnDisk(repo)
    for (const e of onDisk) {
      if (!isManagedPath(repo, e.path)) continue
      try {
        await runGit(repo, ['worktree', 'remove', '--force', e.path])
        removed.push(e.path)
      } catch (err) {
        errors.push({ path: e.path, error: err.message })
      }
    }

    // Sweep leftover dirs under .worktrees that git no longer tracks (e.g. a
    // prior failed remove). Skip anything git still reported above — a remove
    // that errored was already surfaced; don't rm it out from under a lock.
    const tracked = new Set(onDisk.map((e) => e.path))
    for (const name of await fs.readdir(wtRoot).catch(() => [])) {
      const p = resolvePath(wtRoot, name)
      if (tracked.has(p)) continue
      try {
        await fs.rm(p, { recursive: true, force: true })
        removed.push(p)
      } catch (err) {
        errors.push({ path: p, error: err.message })
      }
    }

    await runGit(repo, ['worktree', 'prune']).catch(() => {})
    refcounts.delete(repo)
    return { repo, removed, errors }
  })
}

// Release every tracked worktree across all repos. Called on app quit so a
// clean shutdown leaves disk tidy. Returns the per-(repo,branch) outcomes
// for logging; failures are swallowed (we're shutting down).
export async function releaseAll() {
  const results = []
  // Snapshot to avoid mutating the map while iterating.
  const snapshot = []
  for (const [repo, branchMap] of refcounts.entries()) {
    for (const [branch, entry] of branchMap.entries()) {
      snapshot.push({ repo, branch, refcount: entry.refcount })
    }
  }
  for (const { repo, branch, refcount } of snapshot) {
    // Force the refcount to 1 then release so a single call removes — even
    // if multiple instances were sharing a worktree at quit time.
    const branchMap = refcounts.get(repo)
    const entry = branchMap?.get(branch)
    if (entry) entry.refcount = 1
    try {
      const r = await releaseWorktree(repo, branch)
      results.push({ repo, branch, ...r })
    } catch (err) {
      results.push({
        repo,
        branch,
        removed: false,
        retained: true,
        error: err.message,
        originalRefcount: refcount
      })
    }
  }
  return results
}

// Test-only escape hatch. Production code should never need this; tests want
// a clean slate between cases without juggling many repo/branch tuples.
export function _resetForTests() {
  refcounts.clear()
  mutexes.clear()
}
