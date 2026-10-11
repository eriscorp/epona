import { test, expect } from '@playwright/test'
import { launchEpona, getMainWindow } from './helpers.js'

// The title bar's real geometry. jsdom does not apply media queries, so a padding
// asserted there passes against a layout no build renders. This reads it from the
// built app instead.
//
// The two platforms differ on purpose (the house macOS chrome): macOS keeps the
// native stoplights inset into an empty bar, padded 78px so nothing sits under
// them; Windows and Linux draw the logo, the name and two window buttons, padded
// 12px as before.

const isMac = process.platform === 'darwin'

test.describe('Title bar', () => {
  let electronApp

  test.afterEach(async () => {
    await electronApp?.close()
  })

  test('has the platform chrome, at the padding it always had', async () => {
    ;({ electronApp } = await launchEpona())
    const page = await getMainWindow(electronApp)
    const bar = page.getByTestId('title-bar')
    await expect(bar).toBeVisible()

    const geometry = await bar.evaluate((el) => {
      const cs = getComputedStyle(el)
      const img = el.querySelector('img')
      return {
        pl: cs.paddingLeft,
        pr: cs.paddingRight,
        dragRegion: cs.getPropertyValue('-webkit-app-region'),
        imgLeft: img
          ? Math.round(img.getBoundingClientRect().left - el.getBoundingClientRect().left)
          : null
      }
    })
    // The bar stays a drag region on every platform; on macOS a double-click on
    // it zooms the window natively.
    expect(geometry.dragRegion).toBe('drag')

    if (isMac) {
      expect(geometry).toMatchObject({ pl: '78px', pr: '12px', imgLeft: null })
      await expect(bar.getByText('Epona', { exact: true })).toHaveCount(0)
      await expect(bar.getByRole('button')).toHaveCount(0)
    } else {
      expect(geometry).toMatchObject({ pl: '12px', pr: '12px', imgLeft: 12 })
      await expect(bar.getByText('Epona', { exact: true })).toBeVisible()
      await expect(bar.getByRole('button')).toHaveCount(2)
    }
  })
})
