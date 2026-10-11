import { describe, it, expect } from 'vitest'
import { themesByName, THEME_LABELS } from './index'

// Derived from the registry rather than a hand-kept list, so a theme added to
// `themesByName` is covered without anyone remembering to add it here.
const THEME_NAMES = Object.keys(themesByName)

/**
 * Palette invariants, pinned because a comment was not enough once already.
 *
 * The Hybrasyl theme shipped with `primary.main` set to the same value as
 * `background.default` (`#0d182f`). Every control that signals its active state
 * through `color="primary"` therefore painted itself the colour of the page
 * behind it. In Epona that was the scrollbar thumb, the log-pane toggle when
 * open, and every LinearProgress and CircularProgress. The house template
 * passed the pair to every app byte for byte. See HTOO-341.
 *
 * The bug is that two palette entries held one colour and nothing prevented it,
 * so the test walks EVERY theme rather than the one that was broken.
 */

const lin = (c) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

/** Relative luminance of `#rrggbb`, or of `rgba(r,g,b,a)` ignoring alpha. */
function luminance(color) {
  const rgba = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  const [r, g, b] = rgba
    ? [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])]
    : [
        parseInt(color.slice(1, 3), 16),
        parseInt(color.slice(3, 5), 16),
        parseInt(color.slice(5, 7), 16)
      ]
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('theme palettes', () => {
  it('offers exactly the registered themes in the Settings picker', () => {
    // A theme only in the registry cannot be picked; a theme only in the
    // picker falls back to Hybrasyl without a word.
    expect(Object.keys(THEME_LABELS).sort()).toEqual(THEME_NAMES.slice().sort())
  })

  it('registers all six themes', () => {
    expect(THEME_NAMES).toHaveLength(6)
    for (const name of THEME_NAMES) expect(themesByName[name]).toBeDefined()
  })

  it.each(THEME_NAMES)('%s: primary.main is not the page background', (name) => {
    const p = themesByName[name].palette
    expect(p.primary.main.toLowerCase()).not.toBe(p.background.default.toLowerCase())
  })

  // Thresholds are asserted for `hybrasyl` only, and that is deliberate.
  //
  // Applying them to all six fails five of them on values that predate this
  // card and are NOT the collision it is about. Measured in Epona, 2026-10-11:
  //
  //   theme       main-vs-page   text-on-main
  //   hybrasyl        4.66           4.66     <- HTOO-341
  //   chadul          3.81           3.28
  //   danaan          2.39           6.40
  //   grinneal        3.39           2.72
  //   spark           2.81           6.32
  //   mundanes        2.89           4.60
  //
  // Recolouring five palettes is a design decision, not a side effect of a bug
  // fix, so it is HTOO-355 rather than being smuggled in here — and loosening
  // the threshold to whatever all six happen to pass would assert nothing. The
  // collision rule above still covers every theme, because that one is a hard
  // invariant rather than a judgement.
  describe('hybrasyl', () => {
    const p = themesByName.hybrasyl.palette

    it('primary.main reads as a control against the page and against paper', () => {
      // 3:1 is the WCAG floor for a UI component boundary. This is what "the
      // progress bar is visible at all" reduces to.
      expect(contrast(p.primary.main, p.background.default)).toBeGreaterThanOrEqual(3)
      expect(contrast(p.primary.main, p.background.paper)).toBeGreaterThanOrEqual(3)
    })

    it('contrastText is legible on primary.main', () => {
      // 4.5:1 — chip and button labels are normal-sized text, not large text.
      // This is the assertion that ruled out keeping the theme's cream:
      // #f0e6cc on #4d84d1 measures 3.05:1.
      expect(contrast(p.primary.contrastText, p.primary.main)).toBeGreaterThanOrEqual(4.5)
    })
  })
})
