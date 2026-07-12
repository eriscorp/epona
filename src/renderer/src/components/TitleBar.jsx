import { Toolbar, IconButton, Tooltip, Box, Typography } from '@mui/material'
import { GiContract, GiDeathSkull } from 'react-icons/gi'
import RemoveIcon from '@mui/icons-material/Remove'
import CloseIcon from '@mui/icons-material/Close'
import { toolbarBtnSx } from './toolbarStyles'
import { useSettings } from '../store/settingsStore.js'
import eponaLogo from '../assets/epona.png'

// The plain/corporate themes swap the gamified window glyphs (stroked skull /
// contract) for flat standard icons, matching the house apps. The four fantasy
// themes keep the stylized chrome.
const PLAIN_CHROME_THEMES = ['spark', 'mundanes']

// Flat window-button styling for plain themes — no stroke/hover-swap, just a
// translucent wash. secondary.contrastText reads on the colored title bar.
const plainBtnSx = {
  WebkitAppRegion: 'no-drag',
  color: 'secondary.contrastText',
  '& svg': { fontSize: '1.15em' },
  '&:hover': { backgroundColor: 'action.hover' }
}

export default function TitleBar() {
  const isMac = window.sparkAPI.platform === 'darwin'
  const theme = useSettings((s) => s.settings?.theme)
  const plain = PLAIN_CHROME_THEMES.includes(theme)

  const winBtnSx = plain ? plainBtnSx : toolbarBtnSx
  const closeBtnSx = plain
    ? { ...plainBtnSx, '&:hover': { backgroundColor: 'error.main', color: 'error.contrastText' } }
    : { ...toolbarBtnSx, '&:hover': { backgroundColor: 'info.main', color: 'warning.main' } }

  return (
    <Toolbar
      variant="dense"
      sx={{
        bgcolor: 'secondary.main',
        minHeight: 36,
        // macOS draws its native traffic lights over the top-left (titleBarStyle
        // 'hiddenInset'), so pad the left so the logo/title clear them. Windows/
        // Linux are frameless and keep the in-app controls on the right.
        pl: isMac ? '76px' : 1.5,
        pr: 1.5,
        gap: 1,
        WebkitAppRegion: 'drag',
        flexShrink: 0
      }}
    >
      <Box
        component="img"
        src={eponaLogo}
        alt=""
        sx={{ width: 20, height: 20, borderRadius: 0.5, pointerEvents: 'none' }}
      />
      <Typography
        variant="h6"
        sx={{
          fontWeight: 'bold',
          fontSize: '1.15rem',
          color: 'secondary.contrastText',
          pointerEvents: 'none'
        }}
      >
        Epona
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      {!isMac && (
        <>
          <Tooltip title="Minimize">
            <IconButton size="small" sx={winBtnSx} onClick={() => window.sparkAPI.minimizeWindow()}>
              {plain ? <RemoveIcon /> : <GiContract />}
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton size="small" sx={closeBtnSx} onClick={() => window.sparkAPI.closeWindow()}>
              {plain ? <CloseIcon /> : <GiDeathSkull />}
            </IconButton>
          </Tooltip>
        </>
      )}
    </Toolbar>
  )
}
