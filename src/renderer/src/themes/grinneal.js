import { createTheme, responsiveFontSizes } from '@mui/material/styles';

const grinnealTheme = responsiveFontSizes(createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main:        '#6a7a50',
      light:       '#8a9a68',
      dark:        '#4a5838',
      contrastText:'#d4c4a8',
    },
    secondary: {
      main:        '#907858',
      light:       '#b89870',
      dark:        '#604830',
      contrastText:'#f0e0c8',
    },
    background: {
      default: '#27221c',
      paper:   'rgba(22,18,14,0.88)',
    },
    text: {
      primary:   '#e0d0b4',
      secondary: '#b8a888',
      disabled:  '#6a5e4c',
      button:    '#e0d0b4',
      dark:      '#1a1408',
    },
    divider: 'rgba(122,106,80,0.25)',
    error:   { main: '#ff0000' },
    warning: { main: '#FFFF00' },
    info:    { main: '#6de7f7' },
    success: { main: '#38ff4f' },
  },

  typography: {
    fontFamily: '"Crimson Pro", Georgia, serif',
    h1: { fontFamily: '"Cinzel Decorative", serif', letterSpacing: '0.22em', fontWeight: 400 },
    h2: { fontFamily: '"Cinzel", serif', letterSpacing: '0.08em', fontWeight: 400 },
    h3: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
    h4: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
    h5: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
    h6: { fontFamily: '"Cinzel", serif', letterSpacing: '0.06em', fontWeight: 400 },
    button: { fontFamily: '"Cinzel", serif', letterSpacing: '0.12em', textTransform: 'uppercase' },
    caption: { fontFamily: '"Cinzel", serif', letterSpacing: '0.18em', fontSize: '0.7rem' },
  },

  shape: { borderRadius: 2 },

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
          backgroundColor: 'rgba(22,18,14,0.88)',
          border:          '1px solid rgba(122,106,80,0.32)',
          backdropFilter:  'blur(2px)',
          boxShadow: '-2px -2px 0 0 #4a5838, 2px 2px 0 0 #504030',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
          border: '1px solid #6a7a50',
          color:  '#a8b880',
          '&:hover': { backgroundColor: 'rgba(106,122,80,0.14)', borderColor: '#8a9a68' },
        },
        contained: {
          backgroundColor: 'rgba(106,122,80,0.22)',
          color: '#e0d0b4',
          '&:hover': { backgroundColor: 'rgba(106,122,80,0.36)' },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(10,8,6,0.97)',
          backgroundImage: 'none',
          borderBottom:    '1px solid rgba(122,106,80,0.22)',
          boxShadow:       'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: 'rgba(18,14,10,0.96)',
          borderRight:     '1px solid rgba(122,106,80,0.28)',
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          fontFamily: '"Cinzel", serif', fontSize: '0.7rem', letterSpacing: '0.1em',
          color: '#b8a888', borderBottom: '1px solid rgba(122,106,80,0.08)',
          '&.Mui-selected': { backgroundColor: 'rgba(106,122,80,0.12)', borderLeft: '2px solid #6a7a50', color: '#a8b880' },
          '&:hover': { backgroundColor: 'rgba(122,106,80,0.1)', paddingLeft: '20px' },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(28,22,16,0.93)', border: '1px solid rgba(122,106,80,0.18)',
          backgroundImage: 'none', transition: 'border-color 0.2s, transform 0.2s',
          '&:hover': { borderColor: '#6a7a50', transform: 'translateY(-2px)' },
        },
      },
    },
    MuiDivider: { styleOverrides: { root: { borderColor: 'rgba(122,106,80,0.15)' } } },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: '"Cinzel", serif', fontSize: '0.65rem', letterSpacing: '0.1em',
          backgroundColor: 'rgba(106,122,80,0.14)', color: '#a8b880', border: '1px solid rgba(122,106,80,0.3)',
        },
      },
    },
    MuiPaginationItem: {
      styleOverrides: {
        root: {
          fontFamily: '"Cinzel", serif', fontSize: '0.7rem',
          border: '1px solid rgba(122,106,80,0.2)', color: '#b8a888', borderRadius: 2,
          '&.Mui-selected': { backgroundColor: 'rgba(106,122,80,0.18)', borderColor: '#6a7a50', color: '#a8b880' },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: '"Cinzel", serif', fontSize: '0.7rem', letterSpacing: '0.14em', color: '#b8a888',
          '&.Mui-selected': { color: '#a8b880' },
        },
      },
    },
    MuiTabs: { styleOverrides: { indicator: { backgroundColor: '#6a7a50' } } },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: '#b8a888',
          '&.Mui-focused': { color: '#a8b880' },
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: 'rgba(122,106,80,0.5)',
          '&.Mui-checked': { color: '#a8b880' },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,106,80,0.35)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(122,106,80,0.6)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#a8b880' },
        },
      },
    },
  },
}));

export default grinnealTheme;
