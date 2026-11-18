import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { launchEpona, getMainWindow } from './helpers.js'

// HTOO-685 in the built app, through the real preload: the renderer cannot save
// a program the user did not choose, cannot launch one that reached
// settings.json in another way, and has no generic openPath.

test.describe('Launch authority', () => {
  let electronApp
  let localAppData

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('a forged save keeps the chosen client, and an unchosen one does not launch', async () => {
    const chosen = join('C:', 'epona-e2e', 'chosen', 'Brigid.exe')
    const forged = join('C:', 'epona-e2e', 'forged', 'payload.exe')
    ;({ electronApp, localAppData } = await launchEpona({
      seedSettings: { targets: { hybrasyl: { mode: 'binary', binaryPath: chosen } } }
    }))
    const page = await getMainWindow(electronApp)
    const dir = join(localAppData, 'Erisco', 'Epona')
    const onDisk = () => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf-8'))

    // The first start granted what settings.json named.
    expect(JSON.parse(readFileSync(join(dir, 'grants.json'), 'utf-8')).paths).toContain(chosen)

    // The renderer's API has no path opener.
    expect(await page.evaluate(() => typeof window.sparkAPI.openPath)).toBe('undefined')

    // A save that names a program no dialog returned keeps the chosen one.
    await page.evaluate(async (path) => {
      const s = await window.sparkAPI.loadSettings()
      s.targets.hybrasyl.binaryPath = path
      await window.sparkAPI.saveSettings(s)
    }, forged)
    expect(onDisk().targets.hybrasyl.binaryPath).toBe(chosen)

    // A path written to settings.json by anything but a save has no grant.
    const edited = onDisk()
    edited.targets.hybrasyl.binaryPath = forged
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(edited, null, 2))
    const result = await page.evaluate(() =>
      window.sparkAPI.launch('hybrasyl', {}, { hostname: '', port: 2610 })
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no record that you chose/)
  })

  test('a path that the dialog returned is saved', async () => {
    const picked = join('C:', 'epona-e2e', 'picked', 'Brigid.exe')
    ;({ electronApp, localAppData } = await launchEpona())
    const page = await getMainWindow(electronApp)
    // The user's pick, as the OS dialog would return it.
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, picked)
    const saved = await page.evaluate(async () => {
      const path = await window.sparkAPI.pickFile('Select Hybrasyl client binary')
      const s = await window.sparkAPI.loadSettings()
      s.targets.hybrasyl.binaryPath = path
      await window.sparkAPI.saveSettings(s)
      return (await window.sparkAPI.loadSettings()).targets.hybrasyl.binaryPath
    })
    expect(saved).toBe(picked)
    const dir = join(localAppData, 'Erisco', 'Epona')
    expect(JSON.parse(readFileSync(join(dir, 'grants.json'), 'utf-8')).paths).toContain(picked)
  })
})
