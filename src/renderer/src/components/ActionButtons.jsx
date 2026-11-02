import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Typography from '@mui/material/Typography'
import SnackbarHost from './SnackbarHost.jsx'
import { hybrasylClientPathConfigured, hybrasylAssetWarning } from './actionButtonGate.js'

export default function ActionButtons({ targetKind = 'legacy', settings, getActiveProfile }) {
  const [launching, setLaunching] = useState(false)
  const [testing, setTesting] = useState(false)
  const [snack, setSnack] = useState(null)
  // The Dark Ages folder that the warning names, or null when it is closed (HTOO-669).
  const [noAssetsFolder, setNoAssetsFolder] = useState(null)

  async function handleLaunch() {
    if (targetKind === 'legacy' && !settings.clientPath)
      return setSnack({ severity: 'warning', message: 'No client path set — open Settings' })
    if (targetKind === 'hybrasyl' && !hybrasylClientPathConfigured(settings))
      return setSnack({ severity: 'warning', message: 'No Hybrasyl client path set' })

    // Asked fresh, not read from the toolbar's store entry, which can be for
    // another path or not yet known.
    if (targetKind === 'hybrasyl' && window.sparkAPI.platform !== 'win32') {
      const check = await window.sparkAPI.inspectAssetDir(settings.clientPath)
      if (hybrasylAssetWarning(targetKind, window.sparkAPI.platform, check))
        return setNoAssetsFolder(settings.clientPath)
    }
    await launch()
  }

  async function launch() {
    setNoAssetsFolder(null)
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

      <Dialog
        open={noAssetsFolder !== null}
        onClose={() => setNoAssetsFolder(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: '1rem' }}>The Dark Ages folder has no game files</DialogTitle>
        <DialogContent>
          <Typography
            variant="caption"
            sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all', mb: 1 }}
          >
            {noAssetsFolder}
          </Typography>
          <Typography variant="body2">
            This folder holds no .dat files. The client can start with the assets saved in its own
            settings instead, or show its own launcher. To use this folder, pick the folder that
            holds the Dark Ages files.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setNoAssetsFolder(null)}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={launch}>
            Launch Anyway
          </Button>
        </DialogActions>
      </Dialog>

      <SnackbarHost snack={snack} onClose={() => setSnack(null)} />
    </>
  )
}
