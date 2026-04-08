import { createTheme, responsiveFontSizes } from '@mui/material/styles';

const sparkTheme = responsiveFontSizes(createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main:        '#1060B0',
      light:       '#3080D0',
      dark:        '#0A4080',
      contrastText:'#FFFFFF',
    },
    secondary: {
      main:        '#1060B0',
      light:       '#3080D0',
      dark:        '#0A4080',
      contrastText:'#FFFFFF',
    },
    background: {
      default: '#181818',
      paper:   '#202020',
    },
    text: {
      primary:   '#FFFFFF',
      secondary: '#B0B0B0',
      disabled:  '#808080',
      button:    '#FFFFFF',
      dark:      '#181818',
    },
    divider: '#282828',
    error:   { main: '#ff0000' },
    warning: { main: '#FFFF00' },
    info:    { main: '#3080D0' },
    success: { main: '#38ff4f' },
  },

  typography: {
    fontFamily: '"Segoe UI", "Segoe WP", system-ui, sans-serif',
    fontWeightRegular: 300,
    h1: { fontWeight: 300, letterSpacing: '0.02em' },
    h2: { fontWeight: 300, letterSpacing: '0.02em' },
    h3: { fontWeight: 300, letterSpacing: '0.02em' },
    h4: { fontWeight: 300, letterSpacing: '0.02em' },
    h5: { fontWeight: 300, letterSpacing: '0.02em' },
    h6: { fontWeight: 300, letterSpacing: '0.02em' },
    button: { fontWeight: 400, letterSpacing: '0.04em', textTransform: 'none' },
    caption: { fontWeight: 300, letterSpacing: '0.03em', fontSize: '0.75rem' },
  },

  shape: { borderRadius: 0 },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          textShadow: '0 0 2px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.4)',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: '#202020',
          border:          '1px solid #404040',
          boxShadow:       '0 2px 8px rgba(0,0,0,0.5)',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          border: '1px solid #404040',
          color:  '#FFFFFF',
          opacity: 0.85,
          '&:hover': { backgroundColor: '#303030', borderColor: '#606060', opacity: 1 },
        },
        contained: {
          backgroundColor: '#202020',
          border: '1px solid #404040',
          '&:hover': { backgroundColor: '#303030', borderColor: '#606060' },
          '&:active': { backgroundColor: '#1060B0', borderColor: '#1060B0' },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#181818',
          backgroundImage: 'none',
          borderBottom:    '1px solid #282828',
          boxShadow:       'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#202020',
          borderLeft:     '1px solid #404040',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderBottom: '1px solid #282828',
          '&.Mui-selected': { backgroundColor: 'rgba(16,96,176,0.15)', borderLeft: '2px solid #1060B0', color: '#3080D0' },
          '&:hover': { backgroundColor: '#282828' },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: '#202020', border: '1px solid #404040',
          backgroundImage: 'none', borderRadius: 0,
          '&:hover': { borderColor: '#606060' },
        },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: '#282828' } } },
    MuiChip: {
      styleOverrides: {
        root: {
          fontSize: '0.75rem',
          backgroundColor: '#303030', color: '#B0B0B0', border: '1px solid #404040',
          borderRadius: 0,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontSize: '0.8rem', color: '#808080', textTransform: 'none',
          '&.Mui-selected': { color: '#FFFFFF' },
        },
      },
    },
    MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#1060B0' } } },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          '&.Mui-focused': { color: '#3080D0' },
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: '#404040',
          '&.Mui-checked': { color: '#1060B0' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: '#404040' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#606060' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#1060B0' },
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: { borderRadius: 0 },
      },
    },
  },
}));

export default sparkTheme;
