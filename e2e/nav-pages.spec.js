import { test, expect } from '@playwright/test'
import { GO_TABS } from '../src/shared/appMenu.js'
import { launchEpona, getMainWindow } from './helpers.js'

// Open every tab, in the real renderer, and check none of them crashed (HTOO-393).
// Ported from creidhne, which took it from balor.
//
// The house found this hole in balor: the suite passed 30 of 30 over a page that
// threw on its first click, because each page-driving spec drives the page its
// own work added, and nothing had ever clicked the new tab. Every unit and jsdom
// test passed too, because vitest runs in Node.
//
// It catches what a unit test cannot: an import that resolves only under
// vitest's aliases, a hook order that breaks only under a real React build, a
// channel the IPC guard refuses. rendererNodeGlobals.test.js catches the one
// class (a Node global in the sandboxed renderer) at the source.
//
// The list is DERIVED, not written here: it is GO_TABS from src/shared/appMenu.js,
// the one list App.jsx's TAB_ORDER and the macOS Go menu both read (a plain
// module with no imports, so this Node process can import it, as creidhne's spec
// imports its GO_PAGES). Each tab carries `tab-<kind>` and its panel
// `page-<kind>`. The Settings drawer is added by hand, because it is not a tab.
//
// It asserts on the ERROR BOUNDARY and on the panel marker, not on each panel's
// content, so it does not go stale as the panels change.

const PAGES = [
  ...GO_TABS.map(({ tab }) => ({ name: tab, open: `tab-${tab}`, marker: `page-${tab}` })),
  { name: 'settings', open: 'settings-toggle', marker: 'settings-pane' }
]

// A fault thrown shortly after a panel mounts (an effect, a first IPC answer)
// would otherwise show on the NEXT click, or, on the last page, not at all.
const SETTLE_MS = 250

test.describe('every nav page opens', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('opens each tab and the Settings drawer without hitting the error boundary', async () => {
    // Guard the guard: an emptied GO_TABS would leave only Settings, and the
    // loop would pass on one page.
    expect(PAGES.length, 'GO_TABS lists fewer than three tabs').toBeGreaterThanOrEqual(4)
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)
    const boundary = page.getByTestId('error-boundary-fallback')
    const pageErrors = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    for (const { name, open, marker } of PAGES) {
      const errorsBefore = pageErrors.length
      await page.getByTestId(open).click()
      await page.waitForTimeout(SETTLE_MS)

      // The panel rendered. Without this the loop passes on a click that
      // silently changed nothing. Named per page, so a failure says which.
      await expect(page.getByTestId(marker), `${name}: page marker`).toBeVisible()
      await expect(boundary, `${name}: error boundary`).toHaveCount(0)
      expect(pageErrors.slice(errorsBefore), `${name}: pageerror`).toEqual([])
    }
  })
})
