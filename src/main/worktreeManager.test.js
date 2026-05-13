import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join, resolve as resolvePath } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import {
  sanitizeBranchName,
  ensureWorktree,
  releaseWorktree,
  listOrphanWorktrees,
  releaseAll,
  _resetForTests
} from './worktreeManager.js'

function gitSync(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let err = ''
    child.stderr.on('data', (c) => {
      err += c.toString()
    })
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} → ${code}: ${err}`))
    )
  })
}

async function makeRepo() {
  const repoPath = await fs.mkdtemp(join(tmpdir(), 'epona-wt-'))
  await gitSync(repoPath, ['init', '--initial-branch=main', '-q'])
  await gitSync(repoPath, ['config', 'user.email', 'test@example.com'])
  await gitSync(repoPath, ['config', 'user.name', 'Test'])
  await gitSync(repoPath, ['commit', '--allow-empty', '-m', 'init', '-q'])
  await gitSync(repoPath, ['branch', 'develop'])
  await gitSync(repoPath, ['branch', 'feature/foo'])
  return repoPath
}

describe('sanitizeBranchName', () => {
  it('replaces / with __', () => {
    expect(sanitizeBranchName('feature/foo')).toBe('feature__foo')
  })
  it('leaves plain names unchanged', () => {
    expect(sanitizeBranchName('main')).toBe('main')
    expect(sanitizeBranchName('release-1.2.3')).toBe('release-1.2.3')
  })
  it('replaces other unsafe chars with _', () => {
    expect(sanitizeBranchName('weird:name')).toBe('weird_name')
    expect(sanitizeBranchName('with space')).toBe('with_space')
  })
  it('handles nested paths', () => {
    expect(sanitizeBranchName('release/v1.2.3')).toBe('release__v1.2.3')
  })
  it('throws on empty / non-string input', () => {
    expect(() => sanitizeBranchName('')).toThrow()
    expect(() => sanitizeBranchName(null)).toThrow()
    expect(() => sanitizeBranchName(undefined)).toThrow()
  })
})

describe('worktreeManager', () => {
  let repoPath

  beforeEach(async () => {
    _resetForTests()
    repoPath = await makeRepo()
  })

  afterEach(async () => {
    _resetForTests()
    if (repoPath) {
      // Worktrees may still exist on disk if a test didn't clean up; rm -rf
      // covers all of it. Force is fine because everything is in tmpdir.
      await fs.rm(repoPath, { recursive: true, force: true })
    }
  })

  describe('ensureWorktree', () => {
    it('creates a new worktree at .worktrees/<sanitized-branch>/', async () => {
      const path = await ensureWorktree(repoPath, 'develop')
      expect(path).toBe(resolvePath(repoPath, '.worktrees', 'develop'))
      const stat = await fs.stat(path)
      expect(stat.isDirectory()).toBe(true)
      // Confirm the worktree is checked out to the right branch
      expect(await fs.readFile(join(path, '.git'), 'utf-8')).toContain('worktrees')
    })

    it('sanitizes slash-bearing branch names into the on-disk path', async () => {
      const path = await ensureWorktree(repoPath, 'feature/foo')
      expect(path).toBe(resolvePath(repoPath, '.worktrees', 'feature__foo'))
      expect((await fs.stat(path)).isDirectory()).toBe(true)
    })

    it('shares one on-disk worktree across two ensure calls (refcount)', async () => {
      const a = await ensureWorktree(repoPath, 'develop')
      const b = await ensureWorktree(repoPath, 'develop')
      expect(a).toBe(b)
      // Releasing once should NOT remove (refcount still 1)
      const r1 = await releaseWorktree(repoPath, 'develop')
      expect(r1.removed).toBe(false)
      expect((await fs.stat(a)).isDirectory()).toBe(true)
      // Second release brings it to 0 → removed
      const r2 = await releaseWorktree(repoPath, 'develop')
      expect(r2.removed).toBe(true)
      await expect(fs.stat(a)).rejects.toThrow()
    })

    it('adopts an on-disk worktree created out-of-band (no second add)', async () => {
      // Simulate: a developer ran `git worktree add` themselves before Epona
      // got involved. Epona should adopt that worktree, not try to add again.
      const target = resolvePath(repoPath, '.worktrees', 'develop')
      await fs.mkdir(join(repoPath, '.worktrees'), { recursive: true })
      await gitSync(repoPath, ['worktree', 'add', target, 'develop'])
      // First in-memory ensure adopts (refcount 1, no add attempted — would
      // fail with "already checked out" if it did)
      const path = await ensureWorktree(repoPath, 'develop')
      expect(path).toBe(target)
    })

    it('clears an empty stale dir and creates the worktree fresh', async () => {
      // User reproduced the reported bug: directory exists at the target
      // path but git has no registration for it. Without recovery, the
      // subsequent `git worktree add` fails with exit 128 "already exists".
      const target = resolvePath(repoPath, '.worktrees', 'feature__foo')
      await fs.mkdir(target, { recursive: true })
      const path = await ensureWorktree(repoPath, 'feature/foo')
      expect(path).toBe(target)
      expect((await fs.stat(path)).isDirectory()).toBe(true)
      // Confirm it's a real worktree this time
      expect(await fs.readFile(join(path, '.git'), 'utf-8')).toContain('worktrees')
    })

    it('refuses to clobber a worktree whose admin entry was deleted', async () => {
      // Real worktree on disk, but git's admin entry has been removed entirely.
      // `git worktree repair` cannot recreate a missing admin dir — only fixes
      // path mismatches — so the orphaned `.git` pointer file leaves the dir
      // looking like garbage. Could still contain user edits, so refuse to
      // touch it and surface a clear error.
      const target = resolvePath(repoPath, '.worktrees', 'develop')
      await fs.mkdir(join(repoPath, '.worktrees'), { recursive: true })
      await gitSync(repoPath, ['worktree', 'add', target, 'develop'])
      await fs.rm(join(repoPath, '.git', 'worktrees', 'develop'), {
        recursive: true,
        force: true
      })
      await expect(ensureWorktree(repoPath, 'develop')).rejects.toThrow(/doesn't recognize it/)
    })

    it('refuses to clobber a non-empty stale dir with unknown contents', async () => {
      // Could be user work — error out with a clear message rather than
      // delete or force-overwrite.
      const target = resolvePath(repoPath, '.worktrees', 'feature__foo')
      await fs.mkdir(target, { recursive: true })
      await fs.writeFile(join(target, 'mystery.txt'), 'do not lose me')
      await expect(ensureWorktree(repoPath, 'feature/foo')).rejects.toThrow(/doesn't recognize it/)
      // File should still be there — recovery must not touch it.
      expect(await fs.readFile(join(target, 'mystery.txt'), 'utf-8')).toBe('do not lose me')
    })
  })

  describe('releaseWorktree', () => {
    it('returns { removed: false } when releasing an unknown branch', async () => {
      const r = await releaseWorktree(repoPath, 'never-ensured')
      expect(r).toEqual({ removed: false, retained: false })
    })

    it('retains a dirty worktree instead of failing the release', async () => {
      const path = await ensureWorktree(repoPath, 'develop')
      // Write an untracked file with content — git treats this as dirty for
      // worktree-remove purposes.
      await fs.writeFile(join(path, 'dirty.txt'), 'do not lose me')
      // Stage + commit-blocking modification: stage it so worktree remove
      // refuses without --force.
      await gitSync(path, ['add', 'dirty.txt'])
      const r = await releaseWorktree(repoPath, 'develop')
      expect(r.removed).toBe(false)
      expect(r.retained).toBe(true)
      // Path should still exist on disk
      expect((await fs.stat(path)).isDirectory()).toBe(true)
    })
  })

  describe('listOrphanWorktrees', () => {
    it('reports worktrees on disk that no instance is tracking', async () => {
      // Make a worktree out-of-band (Epona doesn't know about it)
      const target = resolvePath(repoPath, '.worktrees', 'develop')
      await fs.mkdir(join(repoPath, '.worktrees'), { recursive: true })
      await gitSync(repoPath, ['worktree', 'add', target, 'develop'])
      const orphans = await listOrphanWorktrees(repoPath)
      expect(orphans.some((o) => resolvePath(o.path) === target)).toBe(true)
    })

    it('excludes tracked worktrees', async () => {
      await ensureWorktree(repoPath, 'develop')
      const orphans = await listOrphanWorktrees(repoPath)
      const developPath = resolvePath(repoPath, '.worktrees', 'develop')
      expect(orphans.some((o) => resolvePath(o.path) === developPath)).toBe(false)
    })

    it('excludes the main worktree (not under .worktrees/)', async () => {
      const orphans = await listOrphanWorktrees(repoPath)
      // The main checkout itself should never appear — it's not under .worktrees/
      expect(orphans.some((o) => resolvePath(o.path) === resolvePath(repoPath))).toBe(false)
    })
  })

  describe('releaseAll', () => {
    it('removes every tracked worktree regardless of refcount', async () => {
      await ensureWorktree(repoPath, 'develop')
      await ensureWorktree(repoPath, 'develop') // refcount = 2
      await ensureWorktree(repoPath, 'feature/foo')
      const results = await releaseAll()
      expect(results.length).toBe(2)
      expect(results.every((r) => r.removed)).toBe(true)
      // Both worktree dirs should be gone
      await expect(fs.stat(resolvePath(repoPath, '.worktrees', 'develop'))).rejects.toThrow()
      await expect(fs.stat(resolvePath(repoPath, '.worktrees', 'feature__foo'))).rejects.toThrow()
    })
  })
})
