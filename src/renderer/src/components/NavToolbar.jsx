import { Toolbar, IconButton, Tooltip, Divider, Box, Typography } from '@mui/material'
import { GiSettingsKnobs, GiMagnifyingGlass, GiHelp, GiBugNet } from 'react-icons/gi'
import { chromeKind, navButtonSx } from './titleChrome'
import { useSettings } from '../store/settingsStore.js'
import { basenameOfPath } from '../../../shared/pathBasename.js'
import { useAssetDirStatus } from '../useAssetDirStatus.js'

export default function NavToolbar({
  detectedVersion,
  clientPath,
  settingsOpen = false,
  onLocateClient,
  onToggleSettings,
  onOpenHelp,
  onReportIssue
}) {
  const isWindows = window.sparkAPI.platform === 'win32'
  const theme = useSettings((s) => s.settings?.theme)
  // A second bar under the title bar. It paints tertiary.main, so the two bars
  // read as two (HTOO-629). Its buttons take the house nav-bar chrome
  // (titleChrome.js, HTOO-572): the bar's text colour, the house hover, and the
  // one current-page mark, here on Settings while its pane is open. The bar is
  // not faded with opacity: a faded bar draws its text and icons below the
  // ratios the house measures.
  // NavToolbar.test.jsx measures the caption and the icons in each theme.
  const kind = chromeKind(theme)
  // The game glyphs keep the size they had on this bar.
  const btnSx = (current = false) => ({
    ...navButtonSx(kind, current),
    '& svg': { fontSize: '1.4em' },
    mx: -0.5
  })
  // Windows shows the detected legacy-client version (memory-patch target).
  // Non-Windows points at a Dark Ages asset folder, which carries no version —
  // so report whether assets have been located, and which folder. "Located"
  // is the Legacy tab's check of the folder, not a path that is set (HTOO-660).
  const assets = useAssetDirStatus(clientPath, !isWindows)
  const assetsName = clientPath ? basenameOfPath(clientPath) : ''
  const status = isWindows
    ? detectedVersion
      ? { found: true, label: `Client: ${detectedVersion}` }
      : { found: false, label: 'No client detected' }
    : !clientPath || assets?.ok === false
      ? { found: false, label: 'Assets Not Found' }
      : { found: assets?.ok === true, label: `Assets: ${assetsName}` }
  return (
    <Toolbar variant="dense" disableGutters sx={{ bgcolor: 'tertiary.main', minHeight: 40, px: 2 }}>
      {/* Text on the bar is tertiary.contrastText, the title bar's text colour
          (HTOO-572). text.button is for headings on the page: on this bar it
          measured 1.19:1 in mundanes, 1.66:1 in danaan and 4.23:1 in grinneal.
          The "not found" line drew text.disabled (info.main in hybrasyl), below
          4.5:1 in five themes. A located client is bold; a missing one is
          regular weight. */}
      <Typography
        data-testid="client-status"
        variant="caption"
        sx={{
          color: 'tertiary.contrastText',
          ...(status.found && { fontWeight: 'bold', letterSpacing: '0.1em' })
        }}
      >
        {status.label}
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      <Tooltip title={isWindows ? 'Locate Client' : 'Locate Assets'}>
        <IconButton sx={btnSx()} onClick={onLocateClient}>
          <GiMagnifyingGlass />
        </IconButton>
      </Tooltip>

      <Divider
        orientation="vertical"
        flexItem
        sx={{ mx: 1, borderColor: 'rgba(255,255,255,0.2)' }}
      />

      <Tooltip title="Settings">
        <IconButton
          data-testid="settings-toggle"
          aria-pressed={settingsOpen}
          sx={btnSx(settingsOpen)}
          onClick={onToggleSettings}
        >
          <GiSettingsKnobs />
        </IconButton>
      </Tooltip>

      <Tooltip
        title={isWindows ? 'Recommended installs (winget commands)' : 'Recommended installs'}
      >
        <IconButton sx={btnSx()} onClick={onOpenHelp}>
          <GiHelp />
        </IconButton>
      </Tooltip>

      <Tooltip title="Report an issue">
        <IconButton sx={btnSx()} onClick={onReportIssue}>
          <GiBugNet />
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}
