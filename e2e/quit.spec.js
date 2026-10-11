import { test } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// A quit ends the app. before-quit holds the first quit, asks about running
// repo-mode launches, runs the shutdown sweep, and then quits again; the window
// close guard must let that second pass through. A guard that cancelled it
// would leave the app running (with no window, on macOS), and these time out.
//
// The question itself needs a running repo-mode launch, which needs dotnet and a
// checkout, so it is pinned in src/main/index.quit.test.js instead.

test.describe('Quitting', () => {
  test('app.quit() (⌘Q, the menu, the Dock) ends the app', async () => {
    const { electronApp } = await launchEpona()
    await getMainWindow(electronApp)

    const closed = electronApp.waitForEvent('close', { timeout: 15_000 })
    await electronApp.evaluate(({ app }) => {
      setTimeout(() => app.quit(), 0)
    })
    await closed
  })

  test('the title bar close ends the app', async () => {
    // On macOS a window close does not quit, and the title bar has no close.
    test.skip(process.platform === 'darwin', 'closing the window does not quit on macOS')
    const { electronApp } = await launchEpona()
    const page = await getMainWindow(electronApp)

    const closed = electronApp.waitForEvent('close', { timeout: 15_000 })
    await page.evaluate(() => window.sparkAPI.closeWindow())
    await closed
  })
})
