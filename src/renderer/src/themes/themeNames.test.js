import { describe, it, expect } from 'vitest'
import { themesByName } from './index'
import { THEME_NAMES, THEME_LABELS } from '../../../shared/themeNames.js'

// Epona's own check, beside the house palette test. The registry (`index.js`)
// is the template's file, and the names and labels are Epona's
// (`shared/themeNames.js`, so that main can read them). A theme only in the
// registry cannot be picked; a theme only in the picker falls back to Hybrasyl
// without a word.
describe('the theme picker', () => {
  it('offers exactly the registered themes', () => {
    expect(THEME_NAMES.slice().sort()).toEqual(Object.keys(themesByName).sort())
    expect(Object.keys(THEME_LABELS).sort()).toEqual(Object.keys(themesByName).sort())
  })
})
