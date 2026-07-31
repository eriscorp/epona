import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// The renderer runs in the OS sandbox. Nothing about that is visible at build
// time: a preload that requires a package beyond `electron` builds fine, links
// fine, and then throws in the packaged app when the sandboxed loader cannot
// resolve it — taking the whole bridge, and therefore the whole UI, with it.
// These assertions are the only thing standing between that and a release.

test.describe('Preload sandbox', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('the main window is sandboxed and its bridge still works', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    // Read the flag from main rather than inferring it — this fails if someone
    // sets sandbox: false again to make an unrelated preload import work.
    const sandbox = await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
      return win?.webContents.getLastWebPreferences()?.sandbox
    })
    expect(sandbox, 'main window must run sandboxed').toBe(true)

    // `process.platform` is read in the preload. A sandboxed preload gets a
    // POLYFILLED process object, so this is the assertion that catches the
    // polyfill not carrying something the preload depends on.
    const platform = await page.evaluate(() => window.sparkAPI?.platform)
    expect(platform).toBe(process.platform)

    // A round-trip proves contextBridge + ipcRenderer.invoke survive the sandbox,
    // not merely that the object was exposed.
    const version = await page.evaluate(() => window.sparkAPI.getAppVersion())
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('the unused window.electron bridge is gone', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    // @electron-toolkit/preload exposed this and nothing ever read it. Removing
    // it is what made the sandbox reachable, so assert it stays gone rather than
    // getting re-added by a scaffold refresh.
    expect(await page.evaluate(() => 'electron' in window)).toBe(false)
  })
})
