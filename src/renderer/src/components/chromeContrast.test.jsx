// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { IconButton, ThemeProvider } from '@mui/material'
import { getLuminance } from '@mui/material/styles'
import StarIcon from '@mui/icons-material/Star'
// Epona renders the house themes with its own text sizes (themes/eponaThemes.js).
import { themesByName } from '../themes/eponaThemes'
import { blend, contrast } from '../lib/contrast'
import TitleBar from './TitleBar'
import { BUTTON, CLOSE, PLAIN_CHROME_THEMES, chromeKind, navButtonSx } from './titleChrome'

const THEME_NAMES = Object.keys(themesByName)

/** A palette path (`info.main`) in a theme, or a CSS colour as it is. */
function colourOf(name, value) {
  const [group, key] = value.split('.')
  const palette = themesByName[name].palette
  return key && palette[group]?.[key] ? palette[group][key] : value
}

function renderBar(name) {
  render(
    <ThemeProvider theme={themesByName[name]}>
      <TitleBar
        name="Template"
        icon="template.webp"
        theme={name}
        platform="win32"
        controls={{ minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() }}
      />
    </ThemeProvider>
  )
}

/**
 * The title bar reads against itself (WCAG 1.4.11 for icons, 1.4.3 for text),
 * HTOO-572. It paints `secondary.main`, and its window icons and wordmark take
 * `secondary.contrastText`. A theme's overrides can still change what draws,
 * and the palette alone does not show that, so this renders the real bar and
 * reads the colour each theme draws. Taliesin's chromeContrast test, for the
 * template's one bar.
 */
describe('the title bar', () => {
  afterEach(cleanup)

  it.each(THEME_NAMES)('%s: icons are 3:1 and the wordmark 4.5:1 on the bar', (name) => {
    renderBar(name)
    const bar = themesByName[name].palette.secondary.main
    const drawn = (el) => getComputedStyle(el).color
    const icon = drawn(screen.getByRole('button', { name: 'Minimize' }))
    const wordmark = drawn(screen.getByText('Template'))
    expect(contrast(icon, bar), `icon ${icon}`).toBeGreaterThanOrEqual(3)
    expect(contrast(wordmark, bar), `wordmark ${wordmark}`).toBeGreaterThanOrEqual(4.5)
  })

  it.each(THEME_NAMES)('%s: keylines the decorated bar, flattens the plain one', (name) => {
    renderBar(name)
    const shadow = getComputedStyle(screen.getByText('Template')).textShadow
    // jsdom reports `none` as a transparent colour, so the plain case asserts
    // what is absent rather than the keyword.
    if (PLAIN_CHROME_THEMES.includes(name)) expect(shadow).not.toMatch(/#000|rgb\(0, 0, 0\)/)
    else expect(shadow).toMatch(/#000/)
  })

  // jsdom cannot apply :hover, so this reads the hover colours from
  // titleChrome.ts. The decorated close button drew yellow on cyan (1.1:1).
  it.each(THEME_NAMES)('%s: a window button and the close button read on hover', (name) => {
    const bar = themesByName[name].palette.secondary.main
    const kind = chromeKind(name)
    for (const [label, c] of [
      ['window button', BUTTON[kind]],
      ['close button', { ...BUTTON[kind], ...CLOSE }]
    ]) {
      const fill = blend(colourOf(name, c.hoverBackground), bar)
      const glyph = colourOf(name, c.hoverColor)
      expect(contrast(glyph, fill, fill), `${label}: ${glyph} on ${fill}`).toBeGreaterThanOrEqual(3)
    }
  })

  it.each(THEME_NAMES)('%s: no part of the bar is faded with opacity', (name) => {
    // The ratios above are for the drawn colour. An opacity below 1 fades that
    // colour on screen, and getComputedStyle does not show it in `color`:
    // taliesin's nav captions passed at 6:1 and drew 3.84:1 (HTOO-572).
    renderBar(name)
    const faded = [
      screen.getByTestId('title-bar'),
      ...screen.getByTestId('title-bar').querySelectorAll('*')
    ]
      .filter((el) => Number(getComputedStyle(el).opacity || '1') < 1)
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
    expect(faded).toEqual([])
  })

  it('takes a smaller wordmark size from the app', () => {
    render(
      <ThemeProvider theme={themesByName.hybrasyl}>
        <TitleBar
          name="Epona"
          icon="template.webp"
          theme="hybrasyl"
          platform="win32"
          controls={{ minimize: vi.fn(), close: vi.fn() }}
          wordmarkSize="1.15rem"
        />
      </ThemeProvider>
    )
    expect(getComputedStyle(screen.getByText('Epona')).fontSize).toBe('1.15rem')
  })

  it('gives every decorated bar light text, which the keyline outlines', () => {
    // The #000 keyline outlines LIGHT text. Around dark text it merges with the
    // glyph and doubles its edges, which is why danaan's and grinneal's old light
    // bars needed an engrave. A decorated bar must stay dark, with light text.
    const darkText = THEME_NAMES.filter(
      (n) =>
        !PLAIN_CHROME_THEMES.includes(n) &&
        getLuminance(themesByName[n].palette.secondary.contrastText) < 0.18
    )
    expect(darkText).toEqual([])
  })
})

/**
 * A nav bar under the title bar paints `secondary.main` too, with the app's
 * icon buttons on it (HTOO-572). Each app marked the current page its own way,
 * and each mark failed on a dark bar. `navButtonSx` is the one mark.
 */
describe('a nav-bar button', () => {
  afterEach(cleanup)

  it.each(THEME_NAMES)('%s: reads at rest, as the current page, and hovered', (name) => {
    const bar = themesByName[name].palette.secondary.main
    const kind = chromeKind(name)
    render(
      <ThemeProvider theme={themesByName[name]}>
        <IconButton aria-label="rest" sx={navButtonSx(kind)}>
          <StarIcon />
        </IconButton>
        <IconButton aria-label="current" sx={navButtonSx(kind, true)}>
          <StarIcon />
        </IconButton>
      </ThemeProvider>
    )
    const button = (label) => screen.getByRole('button', { name: label })
    const style = (label) => getComputedStyle(button(label))
    // The icon, not the button: the DA themes colour every MUI icon, and an
    // icon that does not inherit drew 1.0:1 on danaan's bar.
    const icon = (label) => getComputedStyle(button(label).querySelector('svg')).color
    const rest = style('rest')
    const current = style('current')
    // A button can carry a label, so 4.5:1, not the 3:1 of an icon.
    expect(contrast(icon('rest'), bar), `rest ${icon('rest')}`).toBeGreaterThanOrEqual(4.5)
    const wash = blend(current.backgroundColor, bar)
    expect(
      contrast(icon('current'), wash),
      `current ${icon('current')} on ${wash}`
    ).toBeGreaterThanOrEqual(4.5)
    // The current page is marked by more than its wash: a ring in the text colour.
    expect(current.boxShadow).toContain('inset')
    expect(current.backgroundColor).not.toBe(rest.backgroundColor)
    // jsdom cannot apply :hover, so the hover is read from titleChrome.ts.
    const fill = blend(colourOf(name, BUTTON[kind].hoverBackground), bar)
    const glyph = colourOf(name, BUTTON[kind].hoverColor)
    expect(contrast(glyph, fill, fill), `hovered ${glyph} on ${fill}`).toBeGreaterThanOrEqual(4.5)
  })
})
