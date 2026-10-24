// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
// Epona renders the house themes with its own text sizes (themes/eponaThemes.js).
import { themesByName } from '../themes/eponaThemes'
import { blend, contrast } from '../lib/contrast'
import { useSettings } from '../store/settingsStore.js'
import NavToolbar from './NavToolbar'

const THEME_NAMES = Object.keys(themesByName)
const ICONS = [
  'Locate Client',
  'Settings',
  'Recommended installs (winget commands)',
  'Report an issue'
]

function mount(name, props = {}) {
  useSettings.setState((s) => ({ settings: { ...s.settings, theme: name } }))
  render(
    <ThemeProvider theme={themesByName[name]}>
      <NavToolbar detectedVersion="7.41" clientPath="C:/DA/Darkages.exe" {...props} />
    </ThemeProvider>
  )
  return screen.getByTestId('client-status').parentElement
}

/** The colour that a button's icon draws in: the svg, not the button. */
const iconColour = (label) =>
  getComputedStyle(screen.getByRole('button', { name: label }).querySelector('svg')).color

/**
 * Epona's second bar, under the title bar (HTOO-572). It paints secondary.main,
 * like the title bar, so its text and icons are held to the house nav-bar rules:
 * the caption 4.5:1, and each icon 4.5:1 at rest and as the current page (the
 * Settings button while its pane is open). The caption drew text.button, the
 * token for headings on the page, and hybrasyl's "not found" line drew
 * info.main. The bar was drawn at 0.85 opacity, which faded every colour on it;
 * it is solid now, as the house title bar is.
 */
describe('the nav toolbar', () => {
  beforeEach(() => {
    window.sparkAPI = { platform: 'win32' }
  })
  afterEach(() => {
    cleanup()
    delete window.sparkAPI
  })

  it.each(THEME_NAMES)('%s: no part of the bar is faded with opacity', (name) => {
    const bar = mount(name)
    const faded = [bar, ...bar.querySelectorAll('*')]
      .filter((el) => Number(getComputedStyle(el).opacity || '1') < 1)
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
    expect(faded).toEqual([])
  })

  it.each(THEME_NAMES)('%s: the caption is 4.5:1 on the bar, found or not', (name) => {
    const bar = themesByName[name].palette.secondary.main
    for (const props of [{}, { detectedVersion: null }]) {
      mount(name, props)
      const caption = getComputedStyle(screen.getByTestId('client-status')).color
      expect(contrast(caption, bar), `caption ${caption} on ${bar}`).toBeGreaterThanOrEqual(4.5)
      cleanup()
    }
  })

  it.each(THEME_NAMES)('%s: each icon is 4.5:1 on the bar, at rest', (name) => {
    const bar = themesByName[name].palette.secondary.main
    mount(name)
    for (const label of ICONS) {
      const icon = iconColour(label)
      expect(contrast(icon, bar), `${label} ${icon} on ${bar}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(THEME_NAMES)('%s: Settings is the current page while its pane is open', (name) => {
    const bar = themesByName[name].palette.secondary.main
    mount(name, { settingsOpen: true })
    const settings = screen.getByRole('button', { name: 'Settings' })
    const style = getComputedStyle(settings)
    const wash = blend(style.backgroundColor, bar)
    const icon = iconColour('Settings')
    expect(contrast(icon, wash), `Settings ${icon} on ${wash}`).toBeGreaterThanOrEqual(4.5)
    // The house mark: a wash and a ring in the text colour.
    expect(style.boxShadow).toContain('inset')
    expect(settings.getAttribute('aria-pressed')).toBe('true')
    // The other buttons are not marked.
    expect(
      getComputedStyle(screen.getByRole('button', { name: 'Report an issue' })).boxShadow
    ).not.toContain('inset')
  })
})
