import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// The companion invariant to settings-offset / multipane-geometry. Those two
// pin the LEFT edge: content must not shift right when a pane opens. Neither
// says anything about the RIGHT edge, which is how a 29px overflow shipped
// unnoticed — every origin was stable, the content was simply wider than the
// viewport it had been given.
//
// The bug: `window:resize` called setMaximumSize(width) — a WINDOW-coordinate
// API — before setContentSize(width), a CONTENT-coordinate API. The max clamped
// the window before the content size could take effect, so the viewport came
// back short by the frame delta. On a 150%-scaled display that compounded to
// 29px: the renderer laid out to its hardcoded MAIN_W of 480 inside a 451px
// viewport. It only reproduces when devicePixelRatio !== 1, which is why it
// survived earlier passes.
//
// Asserting scrollWidth <= clientWidth catches the whole class regardless of
// cause, and reports the offending element rather than just a number.

// One CSS pixel of slack for sub-pixel rounding at fractional DPI.
const TOLERANCE = 1

// Returns { scrollW, clientW, widest } where `widest` names the element whose
// right edge sticks out furthest — turns a bare failure into a lead.
async function measureOverflow(page) {
  return page.evaluate(() => {
    const clientW = document.documentElement.clientWidth
    let widest = null
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      // Ignore zero-size nodes (collapsed panes, portals not yet placed).
      if (r.width === 0 && r.height === 0) continue
      if (r.right > clientW + 0.5 && (!widest || r.right > widest.right)) {
        widest = {
          right: Math.round(r.right),
          tag: el.tagName,
          testid: el.getAttribute('data-testid'),
          cls: (el.className?.baseVal ?? el.className ?? '').toString().slice(0, 80)
        }
      }
    }
    return { scrollW: document.documentElement.scrollWidth, clientW, widest }
  })
}

async function expectNoOverflow(page, label) {
  const { scrollW, clientW, widest } = await measureOverflow(page)
  expect(
    scrollW - clientW,
    `${label}: content is ${scrollW - clientW}px wider than the ${clientW}px viewport` +
      (widest ? ` — widest offender ${JSON.stringify(widest)}` : '')
  ).toBeLessThanOrEqual(TOLERANCE)
  expect(widest, `${label}: element overflows the right edge`).toBeNull()
}

const seedSettings = {
  targetKind: 'hybrasyl',
  targets: { hybrasyl: { mode: 'repo', clientRepoPath: 'C:/nope/client.csproj' } }
}

test.describe('Content never overflows the window', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('no horizontal overflow as panes open and close', async () => {
    ;({ electronApp } = await launchEpona({ seedSettings }))
    const page = await getMainWindow(electronApp)
    const win = await electronApp.browserWindow(page)
    const widthOf = async () => await win.evaluate((bw) => bw.getBounds().width)

    await expectNoOverflow(page, 'closed')

    const closedW = await widthOf()
    await page.getByTestId('log-toggle').click()
    await expect.poll(widthOf, { timeout: 10_000 }).toBeGreaterThan(closedW)
    await expectNoOverflow(page, 'log open')

    const logW = await widthOf()
    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()
    await expect.poll(widthOf, { timeout: 10_000 }).toBeGreaterThan(logW)
    await expectNoOverflow(page, 'log + settings open')

    // Closing must not leave the content wider than the shrunken window — the
    // direction the original min/max ordering bug was worst in.
    await page.getByTestId('settings-toggle').click()
    await expect.poll(widthOf, { timeout: 10_000 }).toBeLessThan(logW + 1)
    await expectNoOverflow(page, 'settings reclosed')
  })

  // The structural guarantee, independent of any particular sizing bug: if the
  // OS hands back a client area NARROWER than the layout's preferred width, the
  // main panel must absorb it and nothing may overflow. Forcing the window
  // narrower simulates every cause at once (frame delta, DPI rounding, a work
  // area too small) without depending on the harness machine's scaling.
  test('a viewport narrower than the preferred width still does not overflow', async () => {
    ;({ electronApp } = await launchEpona({}))
    const page = await getMainWindow(electronApp)
    const win = await electronApp.browserWindow(page)

    for (const shortfall of [1, 12, 29, 60]) {
      await win.evaluate((bw, short) => {
        const [w, h] = bw.getSize()
        bw.setMinimumSize(0, 0)
        bw.setMaximumSize(0, 0)
        bw.setSize(w - short, h)
      }, shortfall)
      // Let the resize reach the renderer and lay out.
      await page.waitForFunction(() => true)
      await page.waitForTimeout(150)
      await expectNoOverflow(page, `viewport ${shortfall}px under preferred`)
    }
  })

  test('the main tabs each fit their viewport', async () => {
    ;({ electronApp } = await launchEpona({}))
    const page = await getMainWindow(electronApp)

    // Exact labels — /Hybrasyl/ alone matches both the Client and Server tabs.
    for (const tab of ['Legacy Client', 'Hybrasyl Client', 'Hybrasyl Server']) {
      const target = page.getByRole('tab', { name: tab, exact: true })
      // The Legacy tab renders disabled off Windows.
      if (!(await target.isEnabled())) continue
      await target.click()
      await expectNoOverflow(page, `${tab} tab`)
    }
  })
})
