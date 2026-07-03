import { promises as fs } from 'fs'
import { runGit, ensureDir } from './gitExec.js'

// runGit + ensureDir live in gitExec.js so worktreeManager.js can share the
// exact same git-spawn scaffold.

// Resolve the toplevel of the git working tree containing `path`, or null if
// `path` isn't inside one. Used to convert a csproj path the user picked into
// the repo root that ensureWorktree / listBranches expect. Accepts either a
// file or a directory inside the repo.
export async function gitToplevel(path) {
  if (typeof path !== 'string' || !path) return null
  const dir = await ensureDir(path)
  try {
    const result = await runGit(dir, ['rev-parse', '--show-toplevel'], { allowFail: true })
    if (result.code !== 0) return null
    return result.stdout || null
  } catch {
    return null
  }
}

// Diagnose whether `repoPath` is inside a git working tree, distinguishing
// the failure modes so the renderer can give the user an actionable message:
//   { ok: true }                       — git present, path is inside a repo
//   { ok: false, reason: 'no_path' }   — empty/non-string input, or path doesn't exist
//   { ok: false, reason: 'no_git' }    — `git` binary not on PATH (spawn ENOENT)
//   { ok: false, reason: 'not_repo' }  — git ran but the path isn't a working tree
//   { ok: false, reason: 'git_error', message } — anything else (rare)
// `no_git` is the case that historically masqueraded as `not_repo` and sent
// non-dev users chasing a phantom repo problem.
export async function diagnoseGitRepo(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath) {
    return { ok: false, reason: 'no_path' }
  }
  const dir = await ensureDir(repoPath)
  // ensureDir falls back to the raw input when the path doesn't exist; probe
  // explicitly so we can return `no_path` instead of letting git error on a
  // nonexistent -C target (which would look like a git misconfiguration).
  try {
    await fs.stat(dir)
  } catch {
    return { ok: false, reason: 'no_path' }
  }
  try {
    const result = await runGit(dir, ['rev-parse', '--is-inside-work-tree'], {
      allowFail: true
    })
    if (result.code === 0 && result.stdout === 'true') return { ok: true }
    return { ok: false, reason: 'not_repo' }
  } catch (err) {
    // spawn('git', ...) ENOENT means the binary isn't on PATH — surface that
    // distinct from "ran but not a repo" so the snackbar can recommend an
    // install one-liner instead of nagging about the user's checkout.
    if (err && err.code === 'ENOENT') return { ok: false, reason: 'no_git' }
    return { ok: false, reason: 'git_error', message: String(err?.message || err) }
  }
}

// Boolean wrapper around diagnoseGitRepo for callers that don't care which
// failure mode they hit (worktreeManager preflight, listBranches guard).
export async function isGitRepo(repoPath) {
  const diag = await diagnoseGitRepo(repoPath)
  return diag.ok
}

// List local + remote-tracking branches in the repo. Returns an array of
// { name, current, remote } sorted: current first, then locals alphabetical,
// then remotes alphabetical. Filters out remote duplicates of local branches
// (origin/foo when foo also exists locally) and the bare HEAD pointer
// (origin/HEAD -> origin/main).
export async function listBranches(repoPath) {
  // Resolve the working dir once and let the single `git branch -a` double as
  // the repo check — it already fails on a non-repo, so a separate isGitRepo()
  // preflight (an extra rev-parse subprocess + stat) is redundant. Map any
  // failure back to the same friendly "Not a git repository" error callers rely
  // on rather than surfacing the raw git message.
  const dir = await ensureDir(repoPath)
  // Standard `git branch -a` output: the first column is either '*' (current)
  // or whitespace, then the ref name. Match with a regex rather than
  // slice(N) — runGit's trim() chews the leading whitespace on the first
  // line, so positional indexing is unreliable.
  //   "* main"                                → current local
  //   "  develop"                             → other local
  //   "  remotes/origin/feature__bar"         → remote-tracking
  //   "  remotes/origin/HEAD -> origin/main"  → alias (filter out via -> match)
  let stdout
  try {
    ;({ stdout } = await runGit(dir, ['branch', '-a']))
  } catch {
    throw new Error(`Not a git repository: ${repoPath}`)
  }
  const locals = []
  const remotes = []
  const localNames = new Set()
  let current = null

  for (const rawLine of stdout.split(/\r?\n/)) {
    const m = rawLine.match(/^(\*|\s+)\s*(\S.*)$/)
    if (!m) continue
    const isCurrent = m[1] === '*'
    const name = m[2].trim()
    if (!name) continue
    // Skip 'remotes/origin/HEAD -> origin/main' aliases.
    if (name.includes(' -> ')) continue
    if (name.startsWith('remotes/')) {
      // Strip the 'remotes/' prefix so callers see 'origin/foo' (matching
      // what users would type or see in their own tools).
      remotes.push(name.replace(/^remotes\//, ''))
    } else {
      locals.push(name)
      localNames.add(name)
      if (isCurrent) current = name
    }
  }

  const dedupedRemotes = remotes.filter((r) => {
    const localEquivalent = r.replace(/^[^/]+\//, '')
    return !localNames.has(localEquivalent)
  })

  locals.sort()
  dedupedRemotes.sort()

  const out = []
  if (current) {
    out.push({ name: current, current: true, remote: false })
    for (const l of locals) {
      if (l !== current) out.push({ name: l, current: false, remote: false })
    }
  } else {
    for (const l of locals) out.push({ name: l, current: false, remote: false })
  }
  for (const r of dedupedRemotes) out.push({ name: r, current: false, remote: true })
  return out
}
