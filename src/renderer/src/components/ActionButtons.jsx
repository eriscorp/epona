import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'

export default function ActionButtons({ settings }) {
  const [launching, setLaunching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [snack, setSnack] = useState(null)

  async function handleLaunch() {
    if (!settings.clientPath) return setSnack({ severity: 'warning', message: 'No client path set' })
    setLaunching(true)
    const result = await window.sparkAPI.launch(settings)
    setLaunching(false)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Launch failed' })
  }

  async function handleTest() {
    if (!settings.serverHostname) return setSnack({ severity: 'warning', message: 'No hostname set' })
    setTesting(true)
    const result = await window.sparkAPI.testConnection(
      settings.serverHostname,
      settings.serverPort,
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
          variant="outlined"
          fullWidth
          disabled={testing || !settings.redirectServer}
          onClick={handleTest}
          startIcon={testing ? <CircularProgress size={14} /> : null}
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
