import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow, readGeometry } from './helpers.js'

// The bug this spec pins down: opening the Settings pane appears to indent the
// UI to the right, springing back when Settings closes. It was originally
// diagnosed as a native client-area X-offset (a WS_THICKFRAME "letterbox" from
// toggling setResizable on Windows). Measuring it disproved that: the outer
// window, the webview origin (letterbox), and the main panel never move
// (letterbox == 0, panel left constant). What actually shifts is the content
// *inside* the MUI title bar + nav toolbar — their responsive gutter padding
// keys off the viewport-width breakpoint (sm = 600px). Closed, the window is
// 480px (< 600) → 16px gutters; open, it's 840px (>= 600) → 24px gutters, so the
// Epona title and "Client: …" status jump right (12px / 8px) and back. The fix
// is `disableGutters` + fixed padding on both toolbars.
//
// So this spec asserts two things at once: the native/webview origin is stable
// (letterbox, panel), AND the actual visible content (title, status) holds its
// screen position across a Settings toggle. It fails on the reflow, passes on
// the fix — a real regression guard, not just an eyeball.

// Sub-pixel rounding between DIP and CSS px is expected; the reflow was 8–12px.
// 1px of slack catches the regression without flaking on rounding.
const TOLERANCE = 1

test.describe('Settings pane does not shift window content', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('content origin is stable across open/close of Settings', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)

    // Baseline: Settings closed.
    const closed = await readGeometry(electronApp, page)

    // Open Settings — the pane mounts and the window widens by PANE_W (360px).
    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toBeVisible()
    // Let the programmatic resize + relayout settle before measuring.
    await expect
      .poll(async () => (await readGeometry(electronApp, page)).native.bounds.width, {
        timeout: 10_000
      })
      .toBeGreaterThan(closed.native.bounds.width)
    const open = await readGeometry(electronApp, page)

    // Close Settings — window narrows back.
    await page.getByTestId('settings-toggle').click()
    await expect(page.getByTestId('settings-pane')).toHaveCount(0)
    await expect
      .poll(async () => (await readGeometry(electronApp, page)).native.bounds.width, {
        timeout: 10_000
      })
      .toBe(closed.native.bounds.width)
    const reclosed = await readGeometry(electronApp, page)

    // Log the raw numbers so the report shows the actual measurement, not just
    // pass/fail — this is the "measure it" the pilot exists to deliver.
    console.log(
      '[offset] letterbox px  closed=%d open=%d reclosed=%d',
      closed.letterbox,
      open.letterbox,
      reclosed.letterbox
    )
    console.log(
      '[offset] panel  left   closed=%d open=%d reclosed=%d',
      closed.dom.panelScreenLeft,
      open.dom.panelScreenLeft,
      reclosed.dom.panelScreenLeft
    )
    console.log(
      '[offset] title  left   closed=%d open=%d reclosed=%d',
      closed.dom.titleScreenLeft,
      open.dom.titleScreenLeft,
      reclosed.dom.titleScreenLeft
    )
    console.log(
      '[offset] status left   closed=%d open=%d reclosed=%d',
      closed.dom.statusScreenLeft,
      open.dom.statusScreenLeft,
      reclosed.dom.statusScreenLeft
    )
    console.log(
      '[offset] contentInset  closed=%d open=%d reclosed=%d',
      closed.contentInset,
      open.contentInset,
      reclosed.contentInset
    )

    // The core assertion: the content's left edge relative to the outer window
    // must not move when Settings opens. A left letterbox would push it right.
    expect(Math.abs(open.letterbox - closed.letterbox)).toBeLessThanOrEqual(TOLERANCE)
    // And it must spring fully back when Settings closes.
    expect(Math.abs(reclosed.letterbox - closed.letterbox)).toBeLessThanOrEqual(TOLERANCE)

    // The visible content a human actually watches for the indent — the Epona
    // title and the "Client: …" status line — must hold their screen position
    // too. These catch a CSS reflow that shifts inner content even if the outer
    // panel/webview origin didn't move.
    for (const key of ['panelScreenLeft', 'titleScreenLeft', 'statusScreenLeft']) {
      expect(Math.abs(open.dom[key] - closed.dom[key])).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(reclosed.dom[key] - closed.dom[key])).toBeLessThanOrEqual(TOLERANCE)
    }

    // The title must not change *size* either — responsiveFontSizes rescales the
    // h6 variant at the 600px breakpoint, so opening a pane (480→840) grew it
    // until it was pinned with a doubled-class rule. Same class of bug as the
    // gutter reflow, different axis.
    console.log(
      '[offset] title fontSize closed=%s open=%s reclosed=%s',
      closed.dom.titleFontSize,
      open.dom.titleFontSize,
      reclosed.dom.titleFontSize
    )
    expect(open.dom.titleFontSize).toBe(closed.dom.titleFontSize)
    expect(reclosed.dom.titleFontSize).toBe(closed.dom.titleFontSize)

    // The outer window's left edge itself shouldn't wander either — the resize
    // grows width to the right, it doesn't reposition the window.
    expect(open.native.bounds.x).toBe(closed.native.bounds.x)
    expect(reclosed.native.bounds.x).toBe(closed.native.bounds.x)
  })
})
