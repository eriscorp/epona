// The theme names that `settings.theme` stores, and the names the user sees.
//
// The theme objects live in the renderer (`renderer/src/themes/`), which main
// cannot import. Main needs the names only, to migrate a retired name on load,
// so the names live here. Keep this file free of electron and node imports.
//
// `renderer/src/themes/themeNames.test.js` checks that this list and the theme
// registry have the same keys.

/** The eight house themes, in picker order. */
export const THEME_NAMES = [
  'hybrasyl',
  'chadul',
  'danaan',
  'grinneal',
  'shattered',
  'untamed',
  'mundanes',
  'dubhaimid'
]

/** The names the Settings theme picker shows. */
export const THEME_LABELS = {
  hybrasyl: 'Hybrasyl',
  chadul: 'Chadul',
  danaan: 'Danaan',
  grinneal: 'Grinneal',
  shattered: 'Shattered',
  untamed: 'Untamed',
  mundanes: 'Mundanes',
  dubhaimid: 'Dubhaimid'
}

/**
 * A retired theme name, and the theme that replaces it.
 *
 * Spark retired in HTOO-572. With the house contrast values it measured within
 * 1.03:1 (accent) and 1.07:1 (page) of dubhaimid, the house dark corporate
 * theme. A settings file that names spark opens in dubhaimid.
 */
export const RETIRED_THEMES = { spark: 'dubhaimid' }

/** The stored theme name to use: a retired name gives its replacement. */
export function migrateThemeName(name) {
  return Object.hasOwn(RETIRED_THEMES, name) ? RETIRED_THEMES[name] : name
}
