import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { launchEpona, getMainWindow, repoRoot } from './helpers.js'

// What's New reads the CHANGELOG.md packaged alongside the app. That path is
// resolved in the main process relative to out/main, and whether the file is
// present at all is a PACKAGING fact — it ships only because electron-builder's
// `files` allowlist names it. Neither of those is reachable from a unit test, so
// this spec drives the built app and asserts the notes actually render.
//
// It is also the regression guard for app.getAppPath(): that call returns the
// entry FILE's directory under this harness's launch style, so a future edit
// "simplifying" the path resolution back to it fails here rather than shipping a
// dialog that is empty only in packaged builds.

test.describe("Settings > About > What's New", () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('renders the shipped changelog and marks the running version', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()

    // The sections are MUI accordions and unmount their children while collapsed,
    // so the About card's buttons are not in the DOM until it is expanded.
    await page.getByRole('button', { name: 'About', exact: true }).click()

    await page.getByRole('button', { name: "What's New" }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: "What's New" })
    await expect(dialog).toBeVisible()

    // The app's own version must appear as a release heading, chipped as current.
    const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')).version
    await expect(dialog.getByText(version, { exact: true })).toBeVisible()
    await expect(dialog.getByText("You're running this")).toBeVisible()

    // Real note text came through the parser, not just the headings — the newest
    // release in the file always has at least one bullet (parseChangelog drops
    // empty sections, so a rendered section implies populated groups).
    await expect(dialog.locator('li').first()).not.toBeEmpty()

    // More than one release is present, i.e. the full history is there to scroll.
    const headings = await dialog.locator('li').count()
    expect(headings).toBeGreaterThan(1)

    expect(pageErrors, `renderer errors: ${pageErrors.join(' | ')}`).toEqual([])

    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).not.toBeVisible()
  })

  test('the old Reveal logs folder button is gone from the About card', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()

    // The sections are MUI accordions and unmount their children while collapsed,
    // so the About card's buttons are not in the DOM until it is expanded.
    await page.getByRole('button', { name: 'About', exact: true }).click()

    // Replaced by What's New. Reveal SETTINGS folder stays; so does reveal-logs
    // inside the Report Issue dialog, which is a different surface.
    await expect(page.getByRole('button', { name: 'Reveal logs folder' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reveal settings folder' })).toBeVisible()
  })
})
