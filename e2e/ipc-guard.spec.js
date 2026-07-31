import { test, expect } from '@playwright/test'
import { join } from 'path'
import { launchEpona, getMainWindow, repoRoot } from './helpers.js'

// Built here rather than inside the evaluate: that callback is serialized into
// the main process and runs without `require`, so it can take paths but not
// compute them.
const ROGUE_PATHS = {
  preload: join(repoRoot, 'out', 'preload', 'index.js'),
  indexHtml: join(repoRoot, 'out', 'renderer', 'index.html')
}

// The unit tests in src/main/windowSecurity.test.js prove the POLICY against
// fakes. They cannot prove the WIRING — that guardIpc actually wraps the ipcMain
// the handlers registered on, and that the main window really was registered as
// trusted. A guard that is correct but never installed passes every unit test and
// protects nothing; a guard that is installed but rejects our own window passes
// them too and bricks the app.
//
// So drive both directions against the real running app.

test.describe('IPC sender guard', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('the main window can reach privileged channels', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    // The allow path. Every other spec depends on this working, but assert it
    // here explicitly so a lockout regression names itself.
    const settings = await page.evaluate(() => window.sparkAPI.loadSettings())
    expect(settings).toBeTruthy()
  })

  test('an unregistered window is refused, even with our preload at our own URL', async () => {
    ;({ electronApp } = await launchEpona())
    await getMainWindow(electronApp)

    // Build the sharpest adversary available: a second window with the SAME
    // preload, loading the SAME index.html. Location and bridge are both
    // legitimate — the only thing it lacks is registerTrustedWindow. If the
    // guard were inert, or keyed on anything weaker than window identity, this
    // would succeed.
    const outcome = await electronApp.evaluate(async ({ BrowserWindow }, paths) => {
      const rogue = new BrowserWindow({
        show: false,
        webPreferences: { preload: paths.preload, sandbox: true }
      })
      await rogue.loadFile(paths.indexHtml)
      const result = await rogue.webContents.executeJavaScript(
        `window.sparkAPI.loadSettings().then(() => 'ALLOWED').catch((e) => 'REFUSED: ' + e.message)`
      )
      rogue.destroy()
      return result
    }, ROGUE_PATHS)

    expect(outcome).toMatch(/^REFUSED/)
    expect(outcome).toContain('untrusted sender')
  })
})
