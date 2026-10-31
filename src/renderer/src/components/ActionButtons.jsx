import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import SnackbarHost from './SnackbarHost.jsx'
import { hybrasylClientPathConfigured } from './actionButtonGate.js'

export default function ActionButtons({ targetKind = 'legacy', settings, getActiveProfile }) {
  const [launching, setLaunching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [snack, setSnack] = useState(null)

  async function handleLaunch() {
    if (targetKind === 'legacy' && !settings.clientPath)
      return setSnack({ severity: 'warning', message: 'No client path set — open Settings' })
    if (targetKind === 'hybrasyl' && !hybrasylClientPathConfigured(settings))
      return setSnack({ severity: 'warning', message: 'No Hybrasyl client path set' })

    const profile = getActiveProfile()
    setLaunching(true)
    const result = await window.sparkAPI.launch(targetKind, settings, profile)
    setLaunching(false)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Launch failed' })
  }

  async function handleTest() {
    const profile = getActiveProfile()
    if (targetKind === 'legacy' && !profile.redirect)
      return setSnack({ severity: 'info', message: 'Official server — no redirect to test' })
    if (!profile.hostname)
      return setSnack({ severity: 'warning', message: 'No hostname set for this profile' })
    setTesting(true)
    const result = await window.sparkAPI.testConnection(
      profile.hostname,
      profile.port,
      settings.version === 'auto' ? 741 : settings.version
    )
    setTesting(false)
    setSnack(
      result.success
        ? { severity: 'success', message: 'Server is reachable' }
        : { severity: 'error', message: result.error ?? 'Connection failed' }
    )
  }

  return (
    <>
      {/* The contained buttons take the theme's label colour (HTOO-572). text.button
          is for headings on the page: on the accent fill of danaan, mundanes and
          dubhaimid it measured 2.41–3.40:1. */}
      <Box sx={{ display: 'flex', gap: 1, mt: 'auto' }}>
        <Button
          variant="contained"
          fullWidth
          disabled={testing}
          onClick={handleTest}
          startIcon={testing ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </Button>
        <Button
          variant="contained"
          fullWidth
          disabled={launching}
          onClick={handleLaunch}
          startIcon={launching ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {launching ? 'Launching…' : 'Launch Client'}
        </Button>
      </Box>

      <SnackbarHost snack={snack} onClose={() => setSnack(null)} />
    </>
  )
}
