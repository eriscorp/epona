import { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Alert from '@mui/material/Alert'
import PathPicker from './PathPicker'
import {
  describeInstallProgress,
  describeInstallResult,
  installPercent
} from '../../../shared/installProgress.js'

// Getting Dark Ages onto a machine that cannot run its installer.
//
// Sits under the folder picker in the Legacy tab on macOS and Linux. Two routes,
// because the download is 208 MB and plenty of people already have the file:
// fetch it, or point at a copy. Both end by writing the destination folder back
// to `clientPath`, so a successful install leaves the tab configured — that is
// the whole point, and it is why this takes `onChange` rather than reporting a
// path for the user to then go and pick by hand.
export default function DarkAgesInstallPanel({ clientPath, onChange }) {
  const [destination, setDestination] = useState('')
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  // Held so a completing install cannot setState after the panel has gone.
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.sparkAPI.onInstallerProgress((payload) => {
      if (mounted.current) setProgress(payload)
    })
    return () => {
      mounted.current = false
      unsubscribe?.()
    }
  }, [])

  const pickDestination = useCallback(async () => {
    const picked = await window.sparkAPI.pickInstallDestination(destination || clientPath)
    if (picked) {
      setDestination(picked)
      setResult(null)
    }
  }, [destination, clientPath])

  // Shared tail of both routes: run it, then adopt the folder on success.
  const finish = useCallback(
    (outcome) => {
      if (!mounted.current) return
      setBusy(false)
      setProgress(null)
      setResult(outcome)
      // Only on a verified install. Pointing clientPath at a folder that failed
      // validation would leave the tab claiming a client it already knows is bad.
      if (outcome?.ok) onChange({ clientPath: outcome.destinationDir ?? destination })
    },
    [onChange, destination]
  )

  const startDownload = useCallback(async () => {
    setBusy(true)
    setResult(null)
    setProgress({ phase: 'resolve' })
    finish(await window.sparkAPI.downloadAndInstall({ destinationDir: destination }))
  }, [destination, finish])

  const startFromFile = useCallback(async () => {
    const installerPath = await window.sparkAPI.pickInstallerFile(clientPath)
    if (!installerPath) return
    setBusy(true)
    setResult(null)
    setProgress({ phase: 'read' })
    finish(await window.sparkAPI.installFromFile({ installerPath, destinationDir: destination }))
  }, [destination, clientPath, finish])

  const cancel = useCallback(() => window.sparkAPI.cancelInstall(), [])

  const percent = installPercent(progress)
  const outcome = describeInstallResult(result)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography variant="caption" color="text.button">
        Don’t have Dark Ages yet?
      </Typography>
      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        The official installer only runs on Windows, so Epona unpacks it for you. Choose where the
        files should go, then download the installer or pick a copy you already have.
      </Typography>

      <PathPicker
        label="Install to"
        value={destination}
        onPick={pickDestination}
        disabled={busy}
        placeholder="Not set"
        pickTestId="installer-destination-browse"
      />

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="contained"
          disabled={busy || !destination}
          onClick={startDownload}
          data-testid="installer-download"
        >
          Download and install
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy || !destination}
          onClick={startFromFile}
          data-testid="installer-from-file"
        >
          Use a downloaded installer…
        </Button>
        {busy && (
          <Button size="small" color="inherit" onClick={cancel} data-testid="installer-cancel">
            Cancel
          </Button>
        )}
      </Box>

      {busy && (
        <Box>
          <Typography variant="caption" data-testid="installer-progress" sx={{ opacity: 0.8 }}>
            {describeInstallProgress(progress)}
          </Typography>
          <LinearProgress
            // Indeterminate where there is no denominator, so the bar does not sit
            // at zero looking stalled while the installer is being read.
            variant={percent === null ? 'indeterminate' : 'determinate'}
            value={percent ?? 0}
            sx={{ mt: 0.5 }}
          />
        </Box>
      )}

      {outcome && (
        <Alert severity={outcome.severity} data-testid="installer-result" sx={{ py: 0 }}>
          {outcome.text}
        </Alert>
      )}
    </Box>
  )
}
