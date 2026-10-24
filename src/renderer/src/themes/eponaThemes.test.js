import { describe, it, expect } from 'vitest'
import { themesByName, EPONA_TYPE_SIZES } from './eponaThemes'
import { themesByName as houseThemes } from './index'

const THEME_NAMES = Object.keys(themesByName)
const mediaKeys = (style) => Object.keys(style).filter((k) => k.startsWith('@media'))

// Epona's text sizes over the house themes (Sabrael, 2026-10-24): the window is
// 480 px wide, so the body text keeps the sizes it had before the house palette.
describe("Epona's themes", () => {
  it('are the six house themes', () => {
    expect(THEME_NAMES).toEqual(Object.keys(houseThemes))
  })

  describe.each(THEME_NAMES)('%s', (name) => {
    const theme = themesByName[name]
    const house = houseThemes[name]

    it.each(Object.entries(EPONA_TYPE_SIZES))('%s is %s at every window width', (variant, size) => {
      expect(theme.typography[variant].fontSize).toBe(size)
      // A media query from responsiveFontSizes would grow the text again when
      // a side pane or the gallery widens the window past 600 px.
      expect(mediaKeys(theme.typography[variant])).toEqual([])
    })

    it('h6 is 1.125rem, and 1.25rem from 600 px, as before the house palette', () => {
      expect(theme.typography.h6.fontSize).toBe('1.125rem')
      expect(theme.typography.h6['@media (min-width:600px)']).toEqual({ fontSize: '1.25rem' })
    })

    it('keeps the house palette, components and fonts', () => {
      expect(theme.palette.primary).toEqual(house.palette.primary)
      expect(theme.palette.secondary).toEqual(house.palette.secondary)
      expect(theme.palette.background).toEqual(house.palette.background)
      expect(theme.palette.text).toEqual(house.palette.text)
      expect(theme.palette.contrastThreshold).toBe(house.palette.contrastThreshold)
      expect(theme.components).toEqual(house.components)
      expect(theme.typography.fontFamily).toBe(house.typography.fontFamily)
      expect(theme.typography.body1.fontFamily).toBe(house.typography.body1.fontFamily)
      expect(theme.typography.h1).toEqual(house.typography.h1)
    })

    it('does not change the house theme', () => {
      // The template's files stay as they are; only Epona's copy is resized.
      expect(house.typography.body1).not.toBe(theme.typography.body1)
      if (house.typography.body1.fontSize !== EPONA_TYPE_SIZES.body1)
        expect(house.typography.body1.fontSize).not.toBe(theme.typography.body1.fontSize)
    })
  })
})
