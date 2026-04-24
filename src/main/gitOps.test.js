import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { isGitRepo, listBranches } from './gitOps.js'

// Helpers — run a real git command in a real temp dir. Slower than mocking
// but catches git-version drift and platform quirks; matches the project's
// pattern (redisProbe uses real net listeners, settingsManager uses real fs).
function gitSync(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let err = ''
    child.stderr.on('data', (c) => { err += c.toString() })
    child.once('exit', (code) => {
      code === 0 ? resolve() : reject(new Error(`git ${args.join(' ')} → ${code}: ${err}`))
    })
  })
}

describe('gitOps', () => {
  let repoPath
  let nonRepoPath

  beforeAll(async () => {
    repoPath = await fs.mkdtemp(join(tmpdir(), 'epona-gitops-repo-'))
    nonRepoPath = await fs.mkdtemp(join(tmpdir(), 'epona-gitops-bare-'))
    // Build a repo with: main (current), feature/foo, develop, plus a fake
    // remote-tracking ref so we exercise the dedup path.
    await gitSync(repoPath, ['init', '--initial-branch=main', '-q'])
    await gitSync(repoPath, ['config', 'user.email', 'test@example.com'])
    await gitSync(repoPath, ['config', 'user.name', 'Test'])
    await gitSync(repoPath, ['commit', '--allow-empty', '-m', 'init', '-q'])
    await gitSync(repoPath, ['branch', 'develop'])
    await gitSync(repoPath, ['branch', 'feature/foo'])
    // Fake a remote-tracking branch by writing the ref directly. Mirrors what
    // `git fetch` would produce without needing an actual remote.
    const remoteRefDir = join(repoPath, '.git', 'refs', 'remotes', 'origin')
    await fs.mkdir(remoteRefDir, { recursive: true })
    const sha = (await import('child_process')).execSync('git rev-parse HEAD', { cwd: repoPath })
      .toString().trim()
    await fs.writeFile(join(remoteRefDir, 'main'), `${sha}\n`)
    await fs.writeFile(join(remoteRefDir, 'staging'), `${sha}\n`)
    await fs.writeFile(join(remoteRefDir, 'feature__bar'), `${sha}\n`)
  })

  afterAll(async () => {
    await fs.rm(repoPath, { recursive: true, force: true })
    await fs.rm(nonRepoPath, { recursive: true, force: true })
  })

  describe('isGitRepo', () => {
    it('returns true for a real git repo', async () => {
      expect(await isGitRepo(repoPath)).toBe(true)
    })
    it('returns false for a directory that is not a git repo', async () => {
      expect(await isGitRepo(nonRepoPath)).toBe(false)
    })
    it('returns false for a non-existent path', async () => {
      expect(await isGitRepo(join(tmpdir(), 'epona-does-not-exist-' + Date.now()))).toBe(false)
    })
    it('returns false for empty / non-string input', async () => {
      expect(await isGitRepo('')).toBe(false)
      expect(await isGitRepo(null)).toBe(false)
      expect(await isGitRepo(undefined)).toBe(false)
    })
  })

  describe('listBranches', () => {
    it('rejects with a friendly error when path is not a git repo', async () => {
      await expect(listBranches(nonRepoPath)).rejects.toThrow(/Not a git repository/)
    })

    it('lists locals and remote-tracking branches with current first', async () => {
      const branches = await listBranches(repoPath)
      expect(branches[0]).toEqual({ name: 'main', current: true, remote: false })
      // After current: other locals (alpha), then remotes (alpha).
      const names = branches.map((b) => b.name)
      expect(names).toContain('develop')
      expect(names).toContain('feature/foo')
      // origin/main should be deduped (local 'main' exists)
      expect(names).not.toContain('origin/main')
      // origin/staging has no local equivalent → kept
      expect(names).toContain('origin/staging')
      expect(names).toContain('origin/feature__bar')
    })

    it('marks remote-tracking branches with remote: true', async () => {
      const branches = await listBranches(repoPath)
      const stagingRef = branches.find((b) => b.name === 'origin/staging')
      expect(stagingRef).toEqual({ name: 'origin/staging', current: false, remote: true })
    })

    it('puts locals before remotes', async () => {
      const branches = await listBranches(repoPath)
      const firstRemoteIdx = branches.findIndex((b) => b.remote)
      const lastLocalIdx = branches.map((b, i) => (b.remote ? -1 : i)).reduce((a, b) => Math.max(a, b), -1)
      expect(lastLocalIdx).toBeLessThan(firstRemoteIdx)
    })
  })
})
