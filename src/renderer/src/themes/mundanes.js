import { createTheme, responsiveFontSizes } from '@mui/material/styles'

// Mundanes — the light "corporate/boring" theme, ported from the house
// Electron template. White/light-gray surfaces, dark text, one restrained
// slate-blue accent, plain system sans type, and flat 1px gray borders with no
// keyline shadows. secondary.main is the classic Windows active-title navy so
// the title bar has a real anchor of color (the TitleBar uses secondary.main).
// Adapted to Epona's simpler palette shape — the template's extra background/
// text tokens (gray, paperMedium, link, headline, …) aren't used here, and the
// status colors are the light-theme MUI variants rather than the neon
// STATUS_COLORS the fantasy dark themes share.
const mundanesTheme = responsiveFontSizes(
  createTheme({
    palette: {
      mode: 'light',
      primary: {
        main: '#1976d2',
        light: '#4a97e0',
        dark: '#115293',
        contrastText: '#ffffff'
      },
      secondary: {
        main: '#0a246a',
        light: '#2f4f8f',
        dark: '#061a4f',
        contrastText: '#ffffff'
      },
      background: {
        default: '#c9cdd4',
        paper: '#ffffff'
      },
      text: {
        primary: '#1a1a1a',
        secondary: '#5f6368',
        disabled: '#9aa0a6',
        button: '#ffffff',
        dark: '#1a1a1a'
      },
      divider: 'rgba(0,0,0,0.12)',
      error: { main: '#d32f2f' },
      warning: { main: '#ed6c02' },
      info: { main: '#0288d1' },
      success: { main: '#2e7d32' }
    },

    typography: {
      fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
      button: { textTransform: 'none' }
    },

    shape: { borderRadius: 6 },

    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
            border: '1px solid rgba(0,0,0,0.12)',
            boxShadow: 'none'
          }
        }
      },
      MuiButton: {
        styleOverrides: {
          root: {
            border: '1px solid rgba(0,0,0,0.23)',
            color: '#1976d2',
            '&:hover': { backgroundColor: 'rgba(25,118,210,0.06)', borderColor: '#1976d2' }
          },
          contained: {
            backgroundColor: '#1976d2',
            color: '#ffffff',
            '&:hover': { backgroundColor: '#115293' }
          }
        }
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            backgroundColor: '#ffffff',
            backgroundImage: 'none',
            color: '#1a1a1a',
            borderBottom: '1px solid rgba(0,0,0,0.12)',
            boxShadow: 'none'
          }
        }
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: '#ffffff',
            borderRight: '1px solid rgba(0,0,0,0.12)'
          }
        }
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            color: '#5f6368',
            '&.Mui-selected': {
              backgroundColor: 'rgba(25,118,210,0.08)',
              borderLeft: '2px solid #1976d2',
              color: '#1976d2'
            },
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' }
          }
        }
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: '#ffffff',
            border: '1px solid rgba(0,0,0,0.12)',
            backgroundImage: 'none',
            boxShadow: '0 1px 3px rgba(0,0,0,0.10)',
            transition: 'border-color 0.2s, box-shadow 0.2s',
            '&:hover': { borderColor: 'rgba(0,0,0,0.24)', boxShadow: '0 2px 6px rgba(0,0,0,0.14)' }
          }
        }
      },
      MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(0,0,0,0.12)' } } },
      MuiChip: {
        styleOverrides: {
          root: {
            backgroundColor: '#eceff1',
            color: '#455a64',
            border: '1px solid rgba(0,0,0,0.12)'
          }
        }
      },
      MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#1976d2' } } },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            color: '#5f6368',
            '&.Mui-selected': { color: '#1976d2' }
          }
        }
      },
      MuiInputLabel: {
        styleOverrides: { root: { '&.Mui-focused': { color: '#1976d2' } } }
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: 'rgba(0,0,0,0.4)',
            '&.Mui-checked': { color: '#1976d2' }
          }
        }
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.23)' },
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.5)' },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#1976d2' }
          }
        }
      }
    }
  })
)

export default mundanesTheme
