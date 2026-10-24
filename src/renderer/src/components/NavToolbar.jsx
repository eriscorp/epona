import { Toolbar, IconButton, Tooltip, Divider, Box, Typography } from '@mui/material'
import { GiSettingsKnobs, GiMagnifyingGlass, GiHelp, GiBugNet } from 'react-icons/gi'
import { chromeKind, windowButtonSx } from './titleChrome'
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
  // A second bar under the title bar. It paints secondary.main too, so its
  // icons take the title bar's window-button chrome from the house module
  // (titleChrome.js): secondary.contrastText, the keyline on the decorated
  // themes, and the same hover (HTOO-572). navToolbar.test.jsx measures them.
  const btnSx = { ...windowButtonSx(chromeKind(theme)), mx: -0.5 }
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
      {/* Text on the bar is secondary.contrastText (HTOO-572). text.button is for
          headings on the page: on this bar it measured 1.19:1 in mundanes, 1.66:1
          in danaan and 4.23:1 in grinneal. The "not found" line drew
          text.disabled (info.main in hybrasyl), below 4.5:1 in five themes. A
          located client is bold; a missing one is regular weight. */}
      <Typography
        data-testid="client-status"
        variant="caption"
        sx={{
          color: 'secondary.contrastText',
          ...(status.found && { fontWeight: 'bold', letterSpacing: '0.1em' })
        }}
      >
        {status.label}
      </Typography>

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
