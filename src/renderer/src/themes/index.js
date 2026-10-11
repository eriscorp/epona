import hybrasylTheme from './hybrasyl'
import chadulTheme from './chadul'
import danaanTheme from './danaan'
import grinnealTheme from './grinneal'
import sparkTheme from './spark'
import mundanesTheme from './mundanes'

// The theme registry. The key is the value that `settings.theme` stores.
// App.jsx selects the active theme from this map, and palette.test.js walks
// it, so a new theme gets the palette checks when it is added here.
export const themesByName = {
  hybrasyl: hybrasylTheme,
  chadul: chadulTheme,
  danaan: danaanTheme,
  grinneal: grinnealTheme,
  spark: sparkTheme,
  mundanes: mundanesTheme
}
