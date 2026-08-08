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

// Getting the Dark Ages client files without running the installer.
//
// Two routes, because the download is 208 MB and plenty of people already have
// the file: fetch it, or point at a copy. Both end by writing the result back to
// `clientPath`, so a successful run leaves the tab configured — that is the whole
// point, and it is why this takes `onChange` rather than reporting a path for the
// user to then go and pick by hand.
//
// `isWindows` changes two things, and the second one is a correctness matter
// rather than presentation:
//
//  1. The wording. On macOS and Linux this is the ONLY way to get a client tree.
//     On Windows the official installer works fine and stays the recommended
//     route, so the copy has to offer this as an alternative rather than imply
//     the installer is unavailable.
//  2. What `clientPath` is set to. That setting holds a FILE on Windows —
//     the client executable — and a DIRECTORY everywhere else. Writing the folder
//     on Windows would leave the Legacy tab pointing at a directory it expects to
//     be an exe, and the launch would fail somewhere that does not name this
//     setting. So on Windows we write the executable the unpack reported.
export default function DarkAgesInstallPanel({ clientPath, onChange, isWindows = false }) {
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
      if (!outcome?.ok) return
      // Only on a verified install. Pointing clientPath at a folder that failed
      // validation would leave the tab claiming a client it already knows is bad.
      //
      // The file-or-directory split is the whole reason isWindows exists here. If
      // the unpack found no executable, fall back to the folder rather than
      // writing null and silently clearing the setting.
      const unpacked = outcome.destinationDir ?? destination
      const target = isWindows ? (outcome.executablePath ?? unpacked) : unpacked
      onChange({ clientPath: target })
    },
    [onChange, destination, isWindows]
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
        {isWindows ? 'Unpack the client files' : 'Don’t have Dark Ages yet?'}
      </Typography>
      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        {isWindows
          ? // Deliberately does not claim to "install" Dark Ages. Unpacking gives a
            // folder of client files; the official installer also writes registry
            // entries, a Start-menu shortcut and an uninstaller, and someone who
            // later looks in Add/Remove Programs should not be surprised.
            'Epona can unpack the official installer into a folder instead of running it — useful for a self-contained copy of the client files. To install Dark Ages normally, run the official installer instead.'
          : 'The official installer only runs on Windows, so Epona unpacks it for you. Choose where the files should go, then download the installer or pick a copy you already have.'}
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
