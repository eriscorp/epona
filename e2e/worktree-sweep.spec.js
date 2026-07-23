import { test, expect } from '@playwright/test'
import { rmSync } from 'fs'
import {
  launchEpona,
  getMainWindow,
  createTempRepoWithWorktree,
  repoModeSettings,
  worktreeExists
} from './helpers.js'

// Epona-managed worktrees used to accumulate forever: refcounts only exist while
// something is running, so switching a branch away (or deleting the instance that
// used it) stranded the old worktree on disk with no automatic path back. The
// startup sweep collects those — but it must never take a worktree with
// uncommitted work in it. Both halves are asserted here against the real app.

test.describe('Startup sweep clears abandoned worktrees', () => {
  let electronApp
  let repo

  test.afterEach(async () => {
    await electronApp?.close()
    if (repo) {
      try {
        rmSync(repo.repoDir, { recursive: true, force: true })
      } catch {
        /* best effort — temp dir */
      }
      repo = null
    }
  })

  test('a clean worktree no saved config references is removed on launch', async () => {
    repo = createTempRepoWithWorktree()
    expect(worktreeExists(repo.worktreeDir), 'worktree should exist before launch').toBe(true)

    // The seeded settings point at the repo but pin no branch, so nothing
    // references 'wt-e2e' — the definition of an orphan.
    ;({ electronApp } = await launchEpona({ seedSettings: repoModeSettings(repo.repoDir) }))
    await getMainWindow(electronApp)

    // The sweep is fire-and-forget at startup, so poll rather than assert once.
    await expect.poll(() => worktreeExists(repo.worktreeDir), { timeout: 15_000 }).toBe(false)
  })

  test('a worktree with uncommitted work is left alone', async () => {
    repo = createTempRepoWithWorktree('wt-e2e', { dirty: true })
    ;({ electronApp } = await launchEpona({ seedSettings: repoModeSettings(repo.repoDir) }))
    const page = await getMainWindow(electronApp)

    // Give the sweep the same room the previous test needed to finish, then
    // assert the worktree survived it.
    await page.waitForTimeout(5000)
    expect(worktreeExists(repo.worktreeDir), 'dirty worktree must survive the sweep').toBe(true)
  })

  test('a worktree whose branch is still configured is kept', async () => {
    repo = createTempRepoWithWorktree()
    const settings = repoModeSettings(repo.repoDir)
    settings.targets.hybrasyl.clientBranch = repo.branch
    ;({ electronApp } = await launchEpona({ seedSettings: settings }))
    const page = await getMainWindow(electronApp)

    await page.waitForTimeout(5000)
    expect(worktreeExists(repo.worktreeDir), 'referenced worktree must be kept').toBe(true)
  })
})
