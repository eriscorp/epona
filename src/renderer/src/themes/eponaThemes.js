import { createTheme } from '@mui/material/styles'
import { themesByName as houseThemes } from './index'

/**
 * The themes that Epona renders: the six house themes, with Epona's text sizes.
 *
 * Epona's window has a fixed size, 480 px wide (MAIN_W). The house typography
 * sets body text at 1.2rem in the four Dark Ages themes, for the large windows
 * of the other house apps. In 480 px that text is too large, so Epona keeps the
 * sizes it had before the house palette (Sabrael, 2026-10-24): MUI's default
 * body and subtitle sizes, at every window width. h6 is the house size, which is
 * also the size Epona had. The title-bar wordmark size is `EPONA_WORDMARK_SIZE`,
 * which AppTitleBar passes to the house TitleBar as `wordmarkSize`.
 *
 * The theme files stay byte-identical to the template (HTOO-572). This file is
 * Epona's own, and it changes typography only: the palette and the component
 * overrides are the house values. App, the theme gallery and the theme tests
 * import `themesByName` from here, so the tests run on the themes Epona draws.
 */

/** Epona's body and subtitle sizes: MUI's defaults, as before the house palette. */
export const EPONA_TYPE_SIZES = {
  body1: '1rem',
  body2: '0.875rem',
  subtitle1: '1rem',
  subtitle2: '0.875rem'
}

/** The title-bar wordmark. The house TitleBar's default is 1.5rem; Epona drew 1.15rem. */
export const EPONA_WORDMARK_SIZE = '1.15rem'

/**
 * A house theme with Epona's text sizes. `responsiveFontSizes` gave the house
 * body1 larger sizes at 600 px and wider, so the size alone is not enough: the
 * variant's media queries go too, and the size is the same at every width.
 * `createTheme` makes new objects, so the house theme does not change.
 */
export function withEponaType(theme) {
  const sized = createTheme(theme, {
    typography: Object.fromEntries(
      Object.entries(EPONA_TYPE_SIZES).map(([variant, fontSize]) => [variant, { fontSize }])
    )
  })
  for (const variant of Object.keys(EPONA_TYPE_SIZES)) {
    const style = { ...sized.typography[variant] }
    for (const key of Object.keys(style)) if (key.startsWith('@media')) delete style[key]
    sized.typography[variant] = style
  }
  return sized
}

/** name → the theme Epona renders. The keys are the house registry's. */
export const themesByName = Object.fromEntries(
  Object.entries(houseThemes).map(([name, theme]) => [name, withEponaType(theme)])
)
