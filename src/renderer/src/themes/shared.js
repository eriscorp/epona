// Shared palette/typography fragments reused across the fantasy themes.

export const STATUS_COLORS = {
  error: { main: '#ff0000' },
  warning: { main: '#FFFF00' },
  info: { main: '#6de7f7' },
  success: { main: '#38ff4f' }
}

export const FANTASY_SHAPE = { borderRadius: 2 }

export const fantasyTypography = {
  fontFamily: '"Crimson Pro", Georgia, serif',
  h1: { fontFamily: '"Cinzel Decorative", serif', letterSpacing: '0.22em', fontWeight: 400 },
  h2: { fontFamily: '"Cinzel", serif', letterSpacing: '0.08em', fontWeight: 400 },
  h3: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
  h4: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
  h5: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
  h6: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
  button: {
    fontFamily: '"Cinzel", serif',
    letterSpacing: '0.12em',
    textTransform: 'uppercase'
  },
  caption: { fontFamily: '"Cinzel", serif', letterSpacing: '0.18em', fontSize: '0.7rem' }
}
