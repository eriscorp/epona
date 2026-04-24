import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join, resolve as resolvePath } from 'path'

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
  mutexes.set(repoPath, next.catch(() => {}))
  return next
}

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => { stdout += c.toString() })
    child.stderr.on('data', (c) => { stderr += c.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim() || '(no stderr)'}`))
    })
  })
}

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
export function ensureWorktree(repoPath, branch) {
  const repo = resolvePath(repoPath)
  return withMutex(repo, async () => {
    const branchMap = refcounts.get(repo) ?? new Map()
    const existing = branchMap.get(branch)
    if (existing) {
      existing.refcount += 1
      branchMap.set(branch, existing)
      refcounts.set(repo, branchMap)
      return existing.path
    }

    const target = worktreePath(repo, branch)

    // Adoption check — is there already a worktree on disk for this branch?
    // Two cases land here: (a) Epona was restarted and our in-memory state is
    // empty; (b) a developer made the worktree manually outside Epona.
    const onDisk = await listWorktreesOnDisk(repo)
    const adopted = onDisk.find(
      (e) => e.branch === branch || resolvePath(e.path) === target
    )
    if (adopted) {
      branchMap.set(branch, { path: adopted.path, refcount: 1 })
      refcounts.set(repo, branchMap)
      return adopted.path
    }

    // Fresh add. Ensure parent dir exists — `git worktree add` creates the
    // leaf dir but expects the parent to be there.
    await fs.mkdir(join(repo, '.worktrees'), { recursive: true })
    await runGit(repo, ['worktree', 'add', target, branch])
    branchMap.set(branch, { path: target, refcount: 1 })
    refcounts.set(repo, branchMap)
    return target
  })
}

// Decrements the refcount; when it hits 0, removes the worktree via git.
// Returns { removed, retained, error } so callers can surface what happened.
// `retained: true` means the worktree had local changes (or removal otherwise
// failed) and was left on disk — the caller can warn the user without
// treating it as a hard failure. We never `--force` by default; force-removing
// a worktree the user has been editing is a bad surprise.
export function releaseWorktree(repoPath, branch) {
  const repo = resolvePath(repoPath)
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

// Lists worktrees on disk under <repoPath>/.worktrees/ that no in-memory
// instance is referencing. Used by the (future) Settings cleanup UI; not
// auto-pruned because dirty worktrees may hold valuable in-progress work.
export async function listOrphanWorktrees(repoPath) {
  const repo = resolvePath(repoPath)
  const onDisk = await listWorktreesOnDisk(repo)
  const tracked = refcounts.get(repo)
  const trackedPaths = new Set(
    [...(tracked?.values() ?? [])].map((e) => resolvePath(e.path))
  )
  const worktreesDir = resolvePath(repo, '.worktrees')
  return onDisk.filter((e) => {
    const p = resolvePath(e.path)
    return p.startsWith(worktreesDir) && !trackedPaths.has(p)
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
      results.push({ repo, branch, removed: false, retained: true, error: err.message, originalRefcount: refcount })
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
