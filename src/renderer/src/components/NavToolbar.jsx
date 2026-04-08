import { Toolbar, IconButton, Tooltip, Divider, Box, Typography } from '@mui/material'
import { GiSettingsKnobs, GiMagnifyingGlass } from 'react-icons/gi'

const iconSx = {
  '& svg': {
    fontSize: '1.4em',
    stroke: 'rgba(0,0,0,0.25)',
    strokeWidth: 44
  }
}

const btnSx = {
  WebkitAppRegion: 'no-drag',
  mx: -0.5,
  color: 'text.button',
  ...iconSx,
  '&:hover': {
    backgroundColor: 'info.main',
    color: 'text.dark'
  }
}

export default function NavToolbar({ detectedVersion, onLocateClient, onToggleSettings }) {
  return (
    <Toolbar variant="dense" sx={{ bgcolor: 'secondary.main', minHeight: 40, opacity: 0.85 }}>
      {detectedVersion ? (
        <Typography
          variant="caption"
          sx={{ color: 'text.button', opacity: 0.9, letterSpacing: '0.1em' }}
        >
          <strong>Client: {detectedVersion}</strong>
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.disabled', opacity: 0.9 }}>
          No client detected
        </Typography>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <Tooltip title="Locate Client">
        <IconButton sx={btnSx} onClick={onLocateClient}>
          <GiMagnifyingGlass />
        </IconButton>
      </Tooltip>

      <Divider
        orientation="vertical"
        flexItem
        sx={{ mx: 1, borderColor: 'rgba(255,255,255,0.2)' }}
      />

      <Tooltip title="Settings">
        <IconButton sx={btnSx} onClick={onToggleSettings}>
          <GiSettingsKnobs />
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}
