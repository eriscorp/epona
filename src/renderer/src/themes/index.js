import hybrasylTheme from './hybrasyl'
import chadulTheme from './chadul'
import danaanTheme from './danaan'
import grinnealTheme from './grinneal'
import sparkTheme from './spark'
import mundanesTheme from './mundanes'

// The theme registry. The key is the value that `settings.theme` stores.
// App.jsx selects the active theme from this map, and palette.test.js walks
// it, so a new theme gets the palette checks when it is added here. Add its
// picker label to THEME_LABELS below too; palette.test.js checks that the two
// lists have the same keys.
export const themesByName = {
  hybrasyl: hybrasylTheme,
  chadul: chadulTheme,
  danaan: danaanTheme,
  grinneal: grinnealTheme,
  spark: sparkTheme,
  mundanes: mundanesTheme
}

// The names the Settings theme picker shows, in picker order.
export const THEME_LABELS = {
  hybrasyl: 'Hybrasyl',
  chadul: 'Chadul',
  danaan: 'Danaan',
  grinneal: 'Grinneal',
  spark: 'Spark',
  mundanes: 'Mundanes'
}
