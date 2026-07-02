import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { dirname } from 'path'

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
export function runGit(cwd, args, { allowFail = false } = {}) {
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
