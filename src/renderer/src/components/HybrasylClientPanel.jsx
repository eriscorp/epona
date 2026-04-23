import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import TerminalIcon from '@mui/icons-material/Terminal'

function kindLabel(kind) {
  if (kind === 'exe') return { label: 'Prebuilt .exe', color: 'success' }
  if (kind === 'repo') return { label: 'Source (dotnet run)', color: 'info' }
  if (kind === 'invalid') return { label: 'Invalid', color: 'error' }
  return { label: 'Not set', color: 'default' }
}

export default function HybrasylClientPanel({ hybrasyl, onChange, logPaneOpen, onToggleLogPane }) {
  const [resolution, setResolution] = useState({ kind: null })
  const [runtime, setRuntime] = useState({ dotnetFound: null, netCoreApp10: null })

  useEffect(() => {
    if (hybrasyl.clientPath) {
      window.sparkAPI.detectHybrasylPath(hybrasyl.clientPath).then(setResolution)
    } else {
      setResolution({ kind: null })
    }
  }, [hybrasyl.clientPath])

  useEffect(() => {
    window.sparkAPI.checkDotnetRuntime().then(setRuntime)
  }, [])

  async function pickClientPath() {
    const path = await window.sparkAPI.pickHybrasylPath()
    if (path) onChange({ targets: { hybrasyl: { ...hybrasyl, clientPath: path } } })
  }

  async function pickDataPath() {
    const path = await window.sparkAPI.pickHybrasylDataDir()
    if (path) onChange({ targets: { hybrasyl: { ...hybrasyl, dataPath: path } } })
  }

  const kind = kindLabel(resolution.kind)
  // Console pane is only meaningful for source/dotnet-run launches — exe
  // launches are fire-and-forget with no stdio pipes (multi-instance allowed).
  const consoleAvailable = resolution.kind === 'repo'
  const consoleTooltip = consoleAvailable
    ? logPaneOpen ? 'Hide console' : 'Show console'
    : 'Console output is only available for source (.csproj) launches'

  const runtimeOk = runtime.netCoreApp10 === true
  const runtimeChip =
    runtime.dotnetFound === null
      ? { label: 'Checking .NET…', color: 'default' }
      : runtimeOk
        ? { label: '.NET 10 detected', color: 'success' }
        : runtime.dotnetFound
          ? { label: '.NET 10 missing', color: 'warning' }
          : { label: '.NET not installed', color: 'error' }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="caption" color="text.button">Client Path</Typography>
          <Chip size="small" label={kind.label} color={kind.color} variant="outlined" />
        </Box>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 11,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              opacity: hybrasyl.clientPath ? 1 : 0.5
            }}
          >
            {hybrasyl.clientPath || '(none — pick a client .exe or .csproj)'}
          </Typography>
          <Button size="small" variant="outlined" onClick={pickClientPath}>
            Browse…
          </Button>
        </Box>
        {resolution.kind === 'invalid' && resolution.reason && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
            {resolution.reason}
          </Typography>
        )}
      </Box>

      <Box>
        <Typography variant="caption" color="text.button" sx={{ mb: 0.5, display: 'block' }}>
          Data Path (where Darkages.cfg is written)
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 11,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {hybrasyl.dataPath}
          </Typography>
          <Button size="small" variant="outlined" onClick={pickDataPath}>
            Browse…
          </Button>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" color="text.button">Runtime</Typography>
        <Chip size="small" label={runtimeChip.label} color={runtimeChip.color} variant="outlined" />
        <Box sx={{ flex: 1 }} />
        <Tooltip title={consoleTooltip}>
          <span>
            <IconButton
              size="small"
              onClick={onToggleLogPane}
              disabled={!consoleAvailable}
              color={logPaneOpen ? 'primary' : 'default'}
            >
              <TerminalIcon fontSize="inherit" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={!!hybrasyl.showConsole}
            onChange={(e) =>
              onChange({ targets: { hybrasyl: { ...hybrasyl, showConsole: e.target.checked } } })
            }
          />
        }
        label={<Typography variant="body2">Show console window</Typography>}
        sx={{ m: 0 }}
      />
    </Box>
  )
}
