import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// Smoke test for all six themes. A theme is a MUI theme object; a bad token
// (missing palette entry, malformed value) throws at *render* time, which jsdom
// unit tests don't catch because they don't mount the fully themed app. Here we
// switch through every theme in the real renderer, assert none throws a page
// error, the app stays mounted, and the background actually changes (proof the
// theme is applied, not silently ignored).

const THEMES = ['Hybrasyl', 'Chadul', 'Danaan', 'Grinneal', 'Spark', 'Mundanes']

test.describe('All themes render without error', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('switching through every theme keeps the app alive and restyled', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    // Fail the test if the renderer throws anything while we drive it.
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()

    const backgrounds = new Set()
    const readBg = () =>
      page.evaluate(
        () => getComputedStyle(document.querySelector('[data-testid="main-panel"]')).backgroundColor
      )

    for (const theme of THEMES) {
      await page.getByTestId('theme-select').click()
      await page.getByRole('option', { name: theme, exact: true }).click()
      // The app must still be mounted and painted after the switch.
      await expect(page.getByTestId('main-panel')).toBeVisible()
      await expect(page.getByTestId('app-title')).toHaveText('Epona')
      backgrounds.add(await readBg())
    }

    // No render-time explosions from any theme object.
    expect(pageErrors, `renderer errors: ${pageErrors.join(' | ')}`).toEqual([])

    // The six themes aren't all the same color — light (Mundanes) vs the dark
    // fantasy themes differ, so we should have seen more than one background.
    expect(backgrounds.size).toBeGreaterThan(1)
  })
})
