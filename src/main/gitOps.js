import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname } from 'path'

// Resolve a path to a directory git can `-C` into. If `p` points at a file
// (e.g. a .csproj inside a repo), return its parent dir; if it's already a
// directory or doesn't exist, return as-is. Lets callers pass either kind of
// path without juggling dirname() at every call site.
async function ensureDir(p) {
  try {
    const stat = await fs.stat(p)
    return stat.isDirectory() ? p : dirname(p)
  } catch {
    return p
  }
}

// Run a git command in the given working directory and return its stdout
// trimmed. On non-zero exit, reject with an Error whose message includes
// stderr — most git failures (not a repo, branch missing, etc.) print useful
// errors to stderr and we want them to surface unmangled.
function runGit(cwd, args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c.toString()
    })
    child.stderr.on('data', (c) => {
      stderr += c.toString()
    })
    child.once('error', (err) => reject(err))
    child.once('exit', (code) => {
      if (code === 0 || allowFail) {
        // Only strip trailing whitespace — leading whitespace is meaningful
        // for some git commands (e.g. `branch -a` puts marker columns there).
        resolve({ code, stdout: stdout.replace(/\s+$/, ''), stderr: stderr.trim() })
      } else {
        reject(
          new Error(
            `git ${args.join(' ')} failed (exit ${code}): ${stderr.trim() || '(no stderr)'}`
          )
        )
      }
    })
  })
}

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

// True iff `repoPath` is inside a git working tree. Used by the repo-path
// picker so the user gets immediate inline feedback ("not a git repo")
// instead of a cryptic worktree-add failure later. Accepts either a file or
// a directory — useful when the caller has a .csproj path in hand.
export async function isGitRepo(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath) return false
  const dir = await ensureDir(repoPath)
  try {
    const result = await runGit(dir, ['rev-parse', '--is-inside-work-tree'], {
      allowFail: true
    })
    return result.code === 0 && result.stdout === 'true'
  } catch {
    return false
  }
}

// List local + remote-tracking branches in the repo. Returns an array of
// { name, current, remote } sorted: current first, then locals alphabetical,
// then remotes alphabetical. Filters out remote duplicates of local branches
// (origin/foo when foo also exists locally) and the bare HEAD pointer
// (origin/HEAD -> origin/main).
export async function listBranches(repoPath) {
  if (!(await isGitRepo(repoPath))) {
    throw new Error(`Not a git repository: ${repoPath}`)
  }
  const dir = await ensureDir(repoPath)
  // Standard `git branch -a` output: the first column is either '*' (current)
  // or whitespace, then the ref name. Match with a regex rather than
  // slice(N) — runGit's trim() chews the leading whitespace on the first
  // line, so positional indexing is unreliable.
  //   "* main"                                → current local
  //   "  develop"                             → other local
  //   "  remotes/origin/feature__bar"         → remote-tracking
  //   "  remotes/origin/HEAD -> origin/main"  → alias (filter out via -> match)
  const { stdout } = await runGit(dir, ['branch', '-a'])
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
