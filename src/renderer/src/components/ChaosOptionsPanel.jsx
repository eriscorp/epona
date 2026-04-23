import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'

function kindLabel(kind) {
  if (kind === 'exe') return { label: 'Prebuilt .exe', color: 'success' }
  if (kind === 'repo') return { label: 'Source (dotnet run)', color: 'info' }
  if (kind === 'invalid') return { label: 'Invalid', color: 'error' }
  return { label: 'Not set', color: 'default' }
}

export default function ChaosOptionsPanel({ chaos, onChange }) {
  const [resolution, setResolution] = useState({ kind: null })
  const [runtime, setRuntime] = useState({ dotnetFound: null, netCoreApp10: null })

  useEffect(() => {
    if (chaos.clientPath) {
      window.sparkAPI.detectChaosPath(chaos.clientPath).then(setResolution)
    } else {
      setResolution({ kind: null })
    }
  }, [chaos.clientPath])

  useEffect(() => {
    window.sparkAPI.checkDotnetRuntime().then(setRuntime)
  }, [])

  async function pickClientPath() {
    const path = await window.sparkAPI.pickChaosPath()
    if (path) onChange({ targets: { chaos: { ...chaos, clientPath: path } } })
  }

  async function pickDataPath() {
    const path = await window.sparkAPI.pickChaosDataDir()
    if (path) onChange({ targets: { chaos: { ...chaos, dataPath: path } } })
  }

  const kind = kindLabel(resolution.kind)
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
              opacity: chaos.clientPath ? 1 : 0.5
            }}
          >
            {chaos.clientPath || '(none — pick a client .exe or .csproj)'}
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
            {chaos.dataPath}
          </Typography>
          <Button size="small" variant="outlined" onClick={pickDataPath}>
            Browse…
          </Button>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" color="text.button">Runtime</Typography>
        <Chip size="small" label={runtimeChip.label} color={runtimeChip.color} variant="outlined" />
      </Box>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={!!chaos.showConsole}
            onChange={(e) =>
              onChange({ targets: { chaos: { ...chaos, showConsole: e.target.checked } } })
            }
          />
        }
        label={<Typography variant="body2">Show console window</Typography>}
        sx={{ m: 0 }}
      />
    </Box>
  )
}
