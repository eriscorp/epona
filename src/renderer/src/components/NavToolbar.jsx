import { Toolbar, IconButton, Tooltip, Divider, Box, Typography } from '@mui/material'
import { GiSettingsKnobs, GiMagnifyingGlass, GiHelp, GiBugNet } from 'react-icons/gi'
import { toolbarBtnSx, gamifiedBtnSx } from './toolbarStyles'
import { chromeTier } from './titleChrome'
import { useSettings } from '../store/settingsStore.js'
import { basenameOfPath } from '../../../shared/pathBasename.js'

export default function NavToolbar({
  detectedVersion,
  clientPath,
  onLocateClient,
  onToggleSettings,
  onOpenHelp,
  onReportIssue
}) {
  const isWindows = window.sparkAPI.platform === 'win32'
  const theme = useSettings((s) => s.settings?.theme)
  // Match the title bar: the dark fantasy themes get the stroked/lifted house
  // glyphs; the light and plain themes keep the soft base stroke.
  const btnSx = { ...(chromeTier(theme) === 'gamified' ? gamifiedBtnSx : toolbarBtnSx), mx: -0.5 }
  // Windows shows the detected legacy-client version (memory-patch target).
  // Non-Windows points at a Dark Ages asset folder, which carries no version —
  // so report whether assets have been located, and which folder.
  const assetsName = clientPath ? basenameOfPath(clientPath) : ''
  const status = isWindows
    ? detectedVersion
      ? { found: true, label: `Client: ${detectedVersion}` }
      : { found: false, label: 'No client detected' }
    : clientPath
      ? { found: true, label: `Assets: ${assetsName}` }
      : { found: false, label: 'Assets Not Found' }
  return (
    <Toolbar
      variant="dense"
      disableGutters
      sx={{ bgcolor: 'secondary.main', minHeight: 40, opacity: 0.85, px: 2 }}
    >
      {status.found ? (
        <Typography
          data-testid="client-status"
          variant="caption"
          sx={{ color: 'text.button', opacity: 0.9, letterSpacing: '0.1em' }}
        >
          <strong>{status.label}</strong>
        </Typography>
      ) : (
        <Typography
          data-testid="client-status"
          variant="caption"
          sx={{ color: 'text.disabled', opacity: 0.9 }}
        >
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
        <IconButton data-testid="settings-toggle" sx={btnSx} onClick={onToggleSettings}>
          <GiSettingsKnobs />
        </IconButton>
      </Tooltip>

      <Tooltip
        title={isWindows ? 'Recommended installs (winget commands)' : 'Recommended installs'}
      >
        <IconButton sx={btnSx} onClick={onOpenHelp}>
          <GiHelp />
        </IconButton>
      </Tooltip>

      <Tooltip title="Report an issue">
        <IconButton sx={btnSx} onClick={onReportIssue}>
          <GiBugNet />
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}
