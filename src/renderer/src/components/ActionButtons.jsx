import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'

export default function ActionButtons({ targetKind = 'legacy', settings, getActiveProfile }) {
  const [launching, setLaunching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [snack, setSnack] = useState(null)

  async function handleLaunch() {
    if (targetKind === 'legacy' && !settings.clientPath)
      return setSnack({ severity: 'warning', message: 'No client path set — open Settings' })
    if (targetKind === 'hybrasyl' && !settings.targets?.hybrasyl?.clientPath)
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
      <Box sx={{ display: 'flex', gap: 1, mt: 'auto' }}>
        <Button
          variant="contained"
          fullWidth
          disabled={testing}
          onClick={handleTest}
          startIcon={testing ? <CircularProgress size={14} /> : null}
          sx={{color: 'text.button'}}
        >
          {testing ? 'Testing…' : 'Test Connection'}
        </Button>
        <Button
          variant="contained"
          fullWidth
          disabled={launching}
          onClick={handleLaunch}
          startIcon={launching ? <CircularProgress size={14} color="inherit" /> : null}
          sx={{color: 'text.button'}}
        >
          {launching ? 'Launching…' : 'Launch Client'}
        </Button>
      </Box>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack?.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
          {snack?.message}
        </Alert>
      </Snackbar>
    </>
  )
}
