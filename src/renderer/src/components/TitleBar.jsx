import { Toolbar, IconButton, Tooltip, Box, Typography } from '@mui/material'
import { GiContract, GiDeathSkull } from 'react-icons/gi'

const iconSx = {
  '& svg': {
    fontSize: '1.4em',
    stroke: 'rgba(0,0,0,0.25)',
    strokeWidth: 44
  }
}

const winBtnSx = {
  WebkitAppRegion: 'no-drag',
  color: 'text.button',
  ...iconSx,
  '&:hover': {
    backgroundColor: 'info.main',
    color: 'text.dark'
  }
}

export default function TitleBar() {
  // macOS draws the native traffic-light controls over the top-left of this bar
  // (titleBarStyle: 'hiddenInset'), so we drop the in-app minimize/close buttons
  // there and pad the left so the logo/title clear the lights. Windows/Linux are
  // frameless and keep the custom controls.
  const isMac = window.sparkAPI.platform === 'darwin'
  return (
    <Toolbar
      variant="dense"
      sx={{
        position: 'relative',
        bgcolor: 'secondary.main',
        minHeight: 36,
        px: 1.5,
        WebkitAppRegion: 'drag',
        flexShrink: 0
      }}
    >
      {/* Absolutely centered over the full bar so the macOS traffic lights (left)
          and the Windows controls (right) don't pull the title off-center.
          pointerEvents: none keeps the whole bar draggable through the title. */}
      <Typography
        variant="h6"
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          textAlign: 'center',
          fontWeight: 'bold',
          fontSize: '1.5rem',
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
              <GiContract />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton
              size="small"
              sx={{
                ...winBtnSx,
                '&:hover': { backgroundColor: 'info.main', color: 'warning.main' }
              }}
              onClick={() => window.sparkAPI.closeWindow()}
            >
              <GiDeathSkull />
            </IconButton>
          </Tooltip>
        </>
      )}
    </Toolbar>
  )
}
