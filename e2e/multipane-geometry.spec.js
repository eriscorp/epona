import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow, readGeometry } from './helpers.js'

// Companion to settings-offset: the same content-origin invariant must hold when
// the Log pane opens too, and when Settings + Log are open at once. The window
// grows MAIN_W + (settings?360) + (log?360), and each extra pane is appended to
// the RIGHT of the main panel — so the title/status/panel left edge must never
// move. Seeds the Hybrasyl tab in repo mode because the console (log) toggle is
// only enabled for source launches.

const TOLERANCE = 1

// Repo mode + hybrasyl target so the app opens on the Hybrasyl tab with the
// console toggle enabled. clientRepoPath need not resolve — mode === 'repo' is
// all the toggle's enablement checks.
const seedSettings = {
  targetKind: 'hybrasyl',
  targets: { hybrasyl: { mode: 'repo', clientRepoPath: 'C:/nope/client.csproj' } }
}

test.describe('Extra panes do not shift window content', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('content origin is stable as Log and Settings panes open', async () => {
    ;({ electronApp } = await launchEpona({ seedSettings }))
    const page = await getMainWindow(electronApp)

    const originLeft = (g) => ({
      panel: g.dom.panelScreenLeft,
      title: g.dom.titleScreenLeft,
      status: g.dom.statusScreenLeft
    })
    const widthOf = async () => (await readGeometry(electronApp, page)).native.bounds.width

    const closed = await readGeometry(electronApp, page)

    // Open the Log (console) pane — window grows by one PANE_W.
    await page.getByTestId('log-toggle').click()
    await expect.poll(widthOf, { timeout: 10_000 }).toBeGreaterThan(closed.native.bounds.width)
    const withLog = await readGeometry(electronApp, page)

    // Also open Settings — window grows by a second PANE_W (both panes right of
    // the main panel).
    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()
    await expect.poll(widthOf, { timeout: 10_000 }).toBeGreaterThan(withLog.native.bounds.width)
    const both = await readGeometry(electronApp, page)

    console.log(
      '[multipane] widths  closed=%d +log=%d +both=%d',
      closed.native.bounds.width,
      withLog.native.bounds.width,
      both.native.bounds.width
    )
    console.log(
      '[multipane] origins closed=%o +log=%o +both=%o',
      originLeft(closed),
      originLeft(withLog),
      originLeft(both)
    )

    for (const g of [withLog, both]) {
      for (const key of ['panelScreenLeft', 'titleScreenLeft', 'statusScreenLeft']) {
        expect(Math.abs(g.dom[key] - closed.dom[key])).toBeLessThanOrEqual(TOLERANCE)
      }
      // Window left edge stays put — panes extend to the right.
      expect(g.native.bounds.x).toBe(closed.native.bounds.x)
    }
  })
})
