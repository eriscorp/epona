import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// The macOS application menu, read from main and clicked there. macOS only: on
// Windows and Linux the window is frameless and Epona installs no menu of its own.
// src/main/appMenu.test.js covers the template on every OS; this checks what is
// installed, and the round trip through the renderer.

test.skip(process.platform !== 'darwin', 'the application menu is macOS only')

const menuItem = (electronApp, id) =>
  electronApp.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId)
    return item ? { label: item.label, enabled: item.enabled, checked: item.checked } : null
  }, id)

const clickItem = (electronApp, id) =>
  electronApp.evaluate(({ Menu }, itemId) => {
    Menu.getApplicationMenu().getMenuItemById(itemId).click()
  }, id)

test.describe('Application menu (macOS)', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close().catch(() => {})
  })

  test("is Epona's own menu, with no Reload", async () => {
    ;({ electronApp } = await launchEpona())
    await getMainWindow(electronApp)

    const roles = await electronApp.evaluate(({ Menu }) => {
      const walk = (menu) =>
        menu.items.flatMap((i) => [i.role, ...(i.submenu ? walk(i.submenu) : [])])
      return walk(Menu.getApplicationMenu()).filter(Boolean)
    })
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forcereload')
    expect(roles).not.toContain('togglefullscreen')
    expect(await menuItem(electronApp, 'about')).toMatchObject({ label: 'About Epona' })
    // The Legacy tab is on screen at boot, so the Log Pane item is greyed out.
    expect(await menuItem(electronApp, 'toggleLogPane')).toMatchObject({ enabled: false })
  })

  test('Go switches the tab, and the menu marks it', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)
    await expect.poll(async () => (await menuItem(electronApp, 'go:legacy'))?.checked).toBe(true)

    await clickItem(electronApp, 'go:server')
    await expect(page.getByRole('tab', { name: 'Hybrasyl Server' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    // The tick follows the renderer's report, so it proves the tab changed.
    await expect.poll(async () => (await menuItem(electronApp, 'go:server'))?.checked).toBe(true)
    expect((await menuItem(electronApp, 'go:legacy')).checked).toBe(false)
  })

  test('does nothing over an open dialog', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    await clickItem(electronApp, 'reportIssue')
    await expect(page.getByRole('dialog')).toBeVisible()
    await clickItem(electronApp, 'go:server')
    await page.waitForTimeout(300)
    expect((await menuItem(electronApp, 'go:server')).checked).toBe(false)
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('About opens the About dialog with the Settings pane closed', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)
    await expect(page.getByTestId('settings-pane')).toHaveCount(0)
    await clickItem(electronApp, 'about')
    await expect(page.getByRole('dialog', { name: /About Epona/i })).toBeVisible()
  })

  test('Check for Updates opens Settings at the update check button', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)
    await expect(page.getByTestId('settings-pane')).toHaveCount(0)
    await clickItem(electronApp, 'checkForUpdates')
    await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible()
  })
})
