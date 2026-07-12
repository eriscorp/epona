import { test, expect } from '@playwright/test'
import { rmSync } from 'fs'
import {
  launchEpona,
  getMainWindow,
  createTempRepoWithWorktree,
  repoModeSettings,
  worktreeExists
} from './helpers.js'

// Regression guard for Settings → Maintenance → Flush Worktrees. This button
// once silently no-op'd: the IPC handler read settingsManager.load() without
// awaiting it, so collectConfiguredRepoPaths gathered nothing from a Promise and
// zero repos were flushed (fixed by the await in repoRoots.js / the handler).
// This drives the real UI against a real on-disk worktree and asserts it's gone
// — the end-to-end behavior a unit test of the gather function can't cover.

test.describe('Flush Worktrees removes managed worktrees', () => {
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

  test('flushing removes the on-disk worktree and reports success', async () => {
    repo = createTempRepoWithWorktree()
    expect(worktreeExists(repo.worktreeDir), 'worktree should exist before flush').toBe(true)
    ;({ electronApp } = await launchEpona({ seedSettings: repoModeSettings(repo.repoDir) }))
    const page = await getMainWindow(electronApp)

    // Open Settings, expand the Maintenance section (Theme is the default-open
    // accordion), then trigger the flush.
    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()
    await page.getByText('Maintenance', { exact: true }).click()
    await page.getByRole('button', { name: 'Flush Worktrees' }).click()

    // Confirmation dialog — the destructive-action guard. Click its "Flush".
    await expect(page.getByText('Flush worktrees?')).toBeVisible()
    await page.getByRole('button', { name: 'Flush', exact: true }).click()

    // The success alert reports what was removed. With one managed worktree in
    // one repo that's "Flushed 1 worktree across 1 repo."
    await expect(page.getByText(/Flushed \d+ worktree/)).toBeVisible()
    await expect(page.getByText(/Flushed 1 worktree.* across 1 repo/)).toBeVisible()

    // Ground truth: the worktree directory is actually gone from disk.
    expect(worktreeExists(repo.worktreeDir), 'worktree should be gone after flush').toBe(false)
  })
})
