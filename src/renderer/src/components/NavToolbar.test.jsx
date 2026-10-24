// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { themesByName } from '../themes'
import { blend, contrast, parseColor } from '../lib/contrast'
import { useSettings } from '../store/settingsStore.js'
import NavToolbar from './NavToolbar'

const THEME_NAMES = Object.keys(themesByName)

/** `color` drawn at `opacity` over `under`, as `#rrggbb`. */
function fade(color, opacity, under) {
  const [r, g, b, a] = parseColor(color)
  return blend(`rgba(${r}, ${g}, ${b}, ${a * opacity})`, under)
}

function mount(name, props = {}) {
  window.sparkAPI = { platform: 'win32' }
  useSettings.setState((s) => ({ settings: { ...s.settings, theme: name } }))
  render(
    <ThemeProvider theme={themesByName[name]}>
      <NavToolbar detectedVersion="7.41" clientPath="C:/DA/Darkages.exe" {...props} />
    </ThemeProvider>
  )
}

/**
 * Epona's second bar, under the title bar (HTOO-572). It paints secondary.main,
 * like the title bar, so its text and icons are held to the title bar's rules:
 * the caption 4.5:1 and the icons 3:1 on the bar. Its caption drew text.button,
 * the token for headings on the page, and hybrasyl's "not found" line drew
 * info.main. The whole bar is drawn at an opacity over the page, so the bar and
 * each colour on it are measured as they reach the screen.
 */
describe('the nav toolbar', () => {
  beforeEach(() => {
    window.sparkAPI = { platform: 'win32' }
  })
  afterEach(() => {
    cleanup()
    delete window.sparkAPI
  })

  it.each(THEME_NAMES)('%s: the caption is 4.5:1 and the icons 3:1 on the bar', (name) => {
    const p = themesByName[name].palette
    for (const props of [{}, { detectedVersion: null }]) {
      mount(name, props)
      const toolbar = screen.getByTestId('client-status').parentElement
      const opacity = Number(getComputedStyle(toolbar).opacity || 1)
      const page = p.background.default
      const bar = fade(p.secondary.main, opacity, page)
      const drawn = (el) => fade(getComputedStyle(el).color, opacity, page)

      const caption = drawn(screen.getByTestId('client-status'))
      expect(contrast(caption, bar), `caption ${caption} on ${bar}`).toBeGreaterThanOrEqual(4.5)
      for (const label of ['Locate Client', 'Settings', 'Report an issue']) {
        const icon = drawn(screen.getByRole('button', { name: label }))
        expect(contrast(icon, bar), `${label} ${icon} on ${bar}`).toBeGreaterThanOrEqual(3)
      }
      cleanup()
    }
  })
})
