import { Toolbar, IconButton, Tooltip, Divider, Box, Typography } from '@mui/material'
import { GiSettingsKnobs, GiMagnifyingGlass } from 'react-icons/gi'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'

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

export default function NavToolbar({
  detectedVersion,
  clientPath,
  onLocateClient,
  onToggleSettings,
  onOpenHelp
}) {
  const isWindows = window.sparkAPI.platform === 'win32'
  // Windows shows the detected legacy-client version (memory-patch target).
  // Non-Windows points at a Dark Ages asset folder, which carries no version —
  // so report whether assets have been located, and which folder.
  const assetsName = clientPath
    ? clientPath
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop()
    : ''
  const status = isWindows
    ? detectedVersion
      ? { found: true, label: `Client: ${detectedVersion}` }
      : { found: false, label: 'No client detected' }
    : clientPath
      ? { found: true, label: `Assets: ${assetsName}` }
      : { found: false, label: 'Assets Not Found' }
  return (
    <Toolbar variant="dense" sx={{ bgcolor: 'secondary.main', minHeight: 40, opacity: 0.85 }}>
      {status.found ? (
        <Typography
          variant="caption"
          sx={{ color: 'text.button', opacity: 0.9, letterSpacing: '0.1em' }}
        >
          <strong>{status.label}</strong>
        </Typography>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.disabled', opacity: 0.9 }}>
          {status.label}
        </Typography>
      )}

      <Box sx={{ flexGrow: 1 }} />

      <Tooltip title={isWindows ? 'Locate Client' : 'Locate Assets'}>
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

      <Tooltip
        title={isWindows ? 'Recommended installs (winget commands)' : 'Recommended installs'}
      >
        <IconButton sx={btnSx} onClick={onOpenHelp}>
          <HelpOutlineIcon />
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}
