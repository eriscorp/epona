import { DEPTH } from './titleChrome'

// Shared sx for the frameless title-bar / nav-toolbar icon buttons. The svg
// treatment (glyph size + outline) and the base button styling (no-drag region,
// themed color, hover swap) are identical across both bars; NavToolbar layers on a
// negative horizontal margin to tighten its row.

// Soft (base) glyph treatment — a subtle dark stroke, no depth. Used by the light
// fantasy theme (danaan) and as the neutral fallback.
export const iconSx = {
  '& svg': {
    fontSize: '1.4em',
    stroke: 'rgba(0,0,0,0.25)',
    strokeWidth: 44
  }
}

// Gamified (house) glyph treatment for the dark fantasy themes: a crisp #000
// keyline via a solid stroke plus a SINGLE depth drop-shadow, so the stroked
// glyphs lift like the wordmark. One depth shadow off a crisp stroke — chaining
// the keyline offsets as drop-shadows would compound and wash out. Matches the
// house apps (mabon/creidhne/oghma).
export const gamifiedIconSx = {
  '& svg': {
    fontSize: '1.4em',
    stroke: '#000',
    strokeWidth: 11,
    filter: `drop-shadow(${DEPTH})`
  }
}

const baseBtn = {
  WebkitAppRegion: 'no-drag',
  color: 'text.button',
  '&:hover': {
    backgroundColor: 'info.main',
    color: 'text.dark'
  }
}

export const toolbarBtnSx = { ...baseBtn, ...iconSx }

export const gamifiedBtnSx = { ...baseBtn, ...gamifiedIconSx }
