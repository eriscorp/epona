import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// End-to-end persistence: a settings change made in the renderer must survive a
// full app restart. This exercises the whole round-trip that unit tests of
// settingsManager can't cover on their own — renderer update() → debounced
// saveSettings IPC → atomic disk write → next launch's load() → hydrate() →
// rendered UI. Both launches share one %LOCALAPPDATA% temp dir.

test.describe('Settings persist across a restart', () => {
  let electronApp
  let localAppData

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('a theme change is still applied after relaunch', async () => {
    // --- First launch: change the theme from the default (hybrasyl). ---
    ;({ electronApp, localAppData } = await launchEpona())
    let page = await getMainWindow(electronApp)

    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()

    // The Theme accordion is open by default; pick Mundanes via its Select.
    await page.getByTestId('theme-select').click()
    await page.getByRole('option', { name: 'Mundanes', exact: true }).click()

    // Wait until the debounced save has actually reached disk — loadSettings()
    // reads settings.json back through the main process, so this confirms the
    // write landed before we kill the app (no arbitrary sleep on the 200ms
    // debounce).
    await expect
      .poll(() => page.evaluate(() => window.sparkAPI.loadSettings().then((s) => s.theme)), {
        timeout: 5000
      })
      .toBe('mundanes')

    await electronApp.close()

    // --- Second launch: same data dir, no seeding. It must hydrate Mundanes. ---
    ;({ electronApp } = await launchEpona({ localAppData }))
    page = await getMainWindow(electronApp)

    // On disk…
    const persisted = await page.evaluate(() => window.sparkAPI.loadSettings().then((s) => s.theme))
    expect(persisted).toBe('mundanes')

    // …and actually applied in the hydrated UI (the Select shows it).
    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('theme-select')).toHaveText('Mundanes')
  })
})
