import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { isCltFailure, CLT_MESSAGE } from './launchEnv/gitFailure.js'

// macOS without the Xcode Command Line Tools (HTOO-512, defect 2). /usr/bin/git
// there is a shim that always exists, so a spawn never fails with ENOENT. Without
// the tools it exits non-zero with xcode-select text, and each call can raise the
// system "install developer tools" dialog again. So the first such answer is kept
// for the process: later calls fail at once, without the shim. reprobeGit()
// clears it, and only a manual action calls it (a folder pick, a branch Refresh
// button, a launch, a server start or reset), never an automatic refresh or the
// startup and quit sweeps.
//
// Only this part of the house launch-env v1 applies to Epona. Its git use is
// local (rev-parse, branch, worktree, status): no fetch, pull or push, so no
// credential prompt and no ssh. The shell environment probe and the ssh and
// credential handling are not needed here.
let cltMissing = false

/** Forget a cached "Command Line Tools missing", so the next git call asks again. */
export function reprobeGit() {
  cltMissing = false
}

function cltError() {
  const err = new Error(CLT_MESSAGE)
  err.code = 'CLT_MISSING'
  return err
}

// Resolve a path to a directory git can `-C` into. If `p` points at a file
// (e.g. a .csproj inside a repo), return its parent dir; if it's already a
// directory or doesn't exist, return as-is. Lets callers pass either kind of
// path without juggling dirname() at every call site.
export async function ensureDir(p) {
  try {
    const stat = await fs.stat(p)
    return stat.isDirectory() ? p : dirname(p)
  } catch {
    return p
  }
}

// Run a git command in the given working directory. Resolves
// { code, stdout, stderr }; on non-zero exit (unless `allowFail`) rejects with
// an Error whose message includes stderr — most git failures (not a repo,
// branch missing, etc.) print useful errors to stderr and we want them to
// surface unmangled. Shared by gitOps.js and worktreeManager.js.
//
// On macOS without the Command Line Tools it rejects with code 'CLT_MISSING'
// and CLT_MESSAGE, also under `allowFail`: git did not run, so there is no exit
// code for a caller to read.
export function runGit(cwd, args, { allowFail = false } = {}) {
  if (cltMissing) return Promise.reject(cltError())
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
      if (code !== 0 && isCltFailure(stderr, process.platform)) {
        cltMissing = true
        reject(cltError())
        return
      }
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
