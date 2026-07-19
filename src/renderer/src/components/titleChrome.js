// Shared shadow vocabulary for the gamified title-bar chrome. KEYLINE is the
// crisp four-way #000 outline; DEPTH is the soft layer that lifts a glyph/wordmark
// off the colored bar. Kept in one place so the wordmark, the app logo, and the
// stroked window glyphs lift identically — and so the values stay in sync with the
// house Electron apps (mabon, creidhne, oghma), which share this exact vocabulary.
// The plain/corporate themes drop both; the light fantasy theme (danaan) keeps its
// own soft glow instead of the black keyline.
export const KEYLINE = ['1px 1px 0 #000', '-1px -1px 0 #000', '1px -1px 0 #000', '-1px 1px 0 #000']
export const DEPTH = '0 2px 3px rgba(0,0,0,0.55)'

// The wordmark is real text: CSS text-shadow paints each layer independently from
// the glyph, so the keyline + depth both read at full strength.
export const TITLE_TEXT_SHADOW = [...KEYLINE, DEPTH].join(', ')

// Chrome tier by theme name, shared by both toolbars so the wordmark, logo, and
// window/nav glyphs classify identically:
//  - 'plain'    (spark/mundanes): flat corporate chrome, no keyline/depth.
//  - 'light'    (danaan): light fantasy theme — keeps its soft gold glow, not the
//               black keyline (which is built for dark bars and reads muddy here).
//  - 'gamified' (hybrasyl/chadul/grinneal): dark fantasy — full keyline + depth.
export const PLAIN_CHROME_THEMES = ['spark', 'mundanes']
export const LIGHT_CHROME_THEMES = ['danaan']

export function chromeTier(theme) {
  if (PLAIN_CHROME_THEMES.includes(theme)) return 'plain'
  if (LIGHT_CHROME_THEMES.includes(theme)) return 'light'
  return 'gamified'
}
