import { createTheme, responsiveFontSizes } from '@mui/material/styles'
import { STATUS_COLORS, FANTASY_SHAPE, fantasyTypography } from './shared'

const danaanHeadingColor = '#2a1e08'

const danaanTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      primary: {
        main: '#b8922a',
        light: '#e8c060',
        dark: '#7a5e18',
        contrastText: '#1a1008'
      },
      secondary: {
        main: '#c8a030',
        light: '#f0d070',
        dark: '#8a6820',
        contrastText: '#1a1008'
      },
      background: {
        default: '#f5e8c0',
        paper: 'rgba(250,242,220,0.94)'
      },
      text: {
        primary: '#2a1e08',
        secondary: '#4a3c20',
        disabled: '#9a8860',
        button: '#0c0902',
        dark: '#1a1008'
      },
      divider: 'rgba(184,146,42,0.3)',
      ...STATUS_COLORS
    },

    typography: {
      ...fantasyTypography,
      h1: { ...fantasyTypography.h1, color: danaanHeadingColor },
      h2: { ...fantasyTypography.h2, color: danaanHeadingColor },
      h3: { ...fantasyTypography.h3, color: danaanHeadingColor },
      h4: { ...fantasyTypography.h4, color: danaanHeadingColor },
      h5: { ...fantasyTypography.h5, color: danaanHeadingColor },
      h6: { ...fantasyTypography.h6, color: danaanHeadingColor }
    },

    shape: FANTASY_SHAPE,

    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            textShadow: '0 0 2px rgba(255,248,225,0.6), 0 0 4px rgba(184,146,42,0.2)'
          }
        }
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            backgroundColor: 'rgba(250,242,220,0.94)',
            border: '1px solid rgba(184,146,42,0.45)',
            backdropFilter: 'blur(2px)',
            boxShadow: '-2px -2px 0 0 #b8922a, 2px 2px 0 0 #b8922a'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 2,
            border: '1px solid #b8922a',
            color: '#7a5e18',
            '&:hover': { backgroundColor: 'rgba(184,146,42,0.12)', borderColor: '#e8c060' }
          },
          contained: {
            backgroundColor: '#b8922a',
            color: '#fff8e8',
            '&:hover': { backgroundColor: '#d4a843' }
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(255,248,225,0.97)',
            backgroundImage: 'none',
            borderBottom: '1px solid rgba(184,146,42,0.3)',
            boxShadow: 'none',
            color: '#2a1e08'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: 'rgba(250,242,220,0.97)',
            borderRight: '1px solid rgba(184,146,42,0.4)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.7rem',
            letterSpacing: '0.1em',
            color: '#4a3c20',
            borderBottom: '1px solid rgba(184,146,42,0.12)',
            '&.Mui-selected': {
              backgroundColor: 'rgba(184,146,42,0.15)',
              borderLeft: '2px solid #b8922a',
              color: '#7a5e18'
            },
            '&:hover': { backgroundColor: 'rgba(184,146,42,0.1)', paddingLeft: '20px' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: 'rgba(255,250,235,0.96)',
            border: '1px solid rgba(184,146,42,0.25)',
            backgroundImage: 'none',
            transition: 'border-color 0.2s, transform 0.2s',
            '&:hover': { borderColor: '#b8922a', transform: 'translateY(-2px)' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(184,146,42,0.2)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            backgroundColor: 'rgba(184,146,42,0.15)',
            color: '#7a5e18',
            border: '1px solid rgba(184,146,42,0.35)'
          }
        }
      },
      MuiPaginationItem: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.7rem',
            border: '1px solid rgba(184,146,42,0.25)',
            color: '#9a8860',
            borderRadius: 2,
            '&.Mui-selected': {
              backgroundColor: 'rgba(184,146,42,0.18)',
              borderColor: '#b8922a',
              color: '#7a5e18'
            }
          }
        }
      },
      MuiTab: {
        styleOverrides: {
          root: {
            fontFamily: '"Cinzel", serif',
            fontSize: '0.7rem',
            letterSpacing: '0.14em',
            color: '#9a8860',
            '&.Mui-selected': { color: '#7a5e18' }
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#b8922a' } } },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: '#5a4828',
            '&.Mui-focused': { color: '#7a5e18' }
          }
        }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(184,146,42,0.5)',
            '&.Mui-checked': { color: '#b8922a' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(184,146,42,0.4)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(184,146,42,0.7)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#b8922a' }
          }
        }
      }
    }
  })
)

export default danaanTheme
