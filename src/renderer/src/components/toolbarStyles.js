// Shared sx for the frameless title-bar / nav-toolbar icon buttons. The svg
// treatment (larger glyph + subtle dark stroke) and the base button styling
// (no-drag region, themed color, hover swap) are identical across both bars;
// NavToolbar layers on a negative horizontal margin to tighten its row.
export const iconSx = {
  '& svg': {
    fontSize: '1.4em',
    stroke: 'rgba(0,0,0,0.25)',
    strokeWidth: 44
  }
}

export const toolbarBtnSx = {
  WebkitAppRegion: 'no-drag',
  color: 'text.button',
  ...iconSx,
  '&:hover': {
    backgroundColor: 'info.main',
    color: 'text.dark'
  }
}
