import { Toolbar, IconButton, Tooltip, Box, Typography } from '@mui/material'
import { GiContract, GiDeathSkull } from 'react-icons/gi'
import RemoveIcon from '@mui/icons-material/Remove'
import CloseIcon from '@mui/icons-material/Close'
import { toolbarBtnSx, gamifiedBtnSx } from './toolbarStyles'
import { DEPTH, TITLE_TEXT_SHADOW, chromeTier } from './titleChrome'
import { useSettings } from '../store/settingsStore.js'
import eponaLogo from '../assets/epona.png'

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
  const tier = chromeTier(theme)
  const plain = tier === 'plain'

  // Wordmark/logo lift, by tier:
  //  - plain (spark/mundanes): no shadow at all.
  //  - light (danaan): leave the wordmark shadow unset so it keeps inheriting the
  //    theme's soft gold body glow; no black drop-shadow on the logo.
  //  - gamified (dark fantasy): the house keyline + depth.
  const wordmarkShadow = plain ? 'none' : tier === 'light' ? undefined : TITLE_TEXT_SHADOW
  const logoFilter = tier === 'gamified' ? `drop-shadow(${DEPTH})` : 'none'

  // Window glyphs: plain gets the flat wash; gamified gets the stroked/lifted
  // house treatment; light keeps the soft base stroke.
  const baseBtnSx = tier === 'gamified' ? gamifiedBtnSx : toolbarBtnSx
  const winBtnSx = plain ? plainBtnSx : baseBtnSx
  const closeBtnSx = plain
    ? { ...plainBtnSx, '&:hover': { backgroundColor: 'error.main', color: 'error.contrastText' } }
    : { ...baseBtnSx, '&:hover': { backgroundColor: 'info.main', color: 'warning.main' } }

  return (
    <Toolbar
      variant="dense"
      disableGutters
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
        sx={{ width: 20, height: 20, borderRadius: 0.5, filter: logoFilter, pointerEvents: 'none' }}
      />
      <Typography
        data-testid="app-title"
        variant="h6"
        sx={{
          fontWeight: 'bold',
          // responsiveFontSizes() attaches sm/md/lg font-size media queries to
          // the h6 variant, so the title would grow when the window crosses a
          // breakpoint — e.g. 480→840px when a side pane opens (18.4→20px). The
          // doubled-class `&&` outranks those media-query rules, pinning the
          // size at every width. (Kept variant="h6" for its Cinzel font.)
          '&&': { fontSize: '1.15rem' },
          color: 'secondary.contrastText',
          textShadow: wordmarkShadow,
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
