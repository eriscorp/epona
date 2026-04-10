import { Toolbar, IconButton, Tooltip, Box, Typography } from '@mui/material'
import { GiContract, GiExpand, GiDeathSkull } from 'react-icons/gi'
import eponaLogo from '../assets/epona.png'

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
  return (
    <Toolbar
      variant="dense"
      sx={{
        bgcolor: 'secondary.main',
        minHeight: 36,
        px: 1.5,
        WebkitAppRegion: 'drag',
        flexShrink: 0
      }}
    >
      <img src={eponaLogo} alt="Epona" style={{ height: 28, marginRight: 8 }} />
      <Typography variant="h6" sx={{ fontWeight: 'bold', flexGrow: 0, fontSize: '1.5rem' }}>
        Epona
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      <Tooltip title="Minimize">
        <IconButton
          size="small"
          sx={winBtnSx}
          onClick={() => window.sparkAPI.minimizeWindow()}
        >
          <GiContract />
        </IconButton>
      </Tooltip>
      <Tooltip title="Close">
        <IconButton
          size="small"
          sx={{ ...winBtnSx, '&:hover': { backgroundColor: 'info.main', color: 'warning.main' } }}
          onClick={() => window.sparkAPI.closeWindow()}
        >
          <GiDeathSkull />
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}
