import { useState, useEffect, useCallback, useRef } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import InfoOutlineIcon from '@mui/icons-material/InfoOutlined'
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
// `isWindows` changes exactly one thing, and it is not presentation: **what
// `clientPath` is set to.** That setting holds a FILE on Windows — the client
// executable — and a DIRECTORY everywhere else. Writing the folder on Windows
// would leave the Legacy tab pointing at a directory where it expects an exe, and
// the launch would fail somewhere that does not name this setting. So on Windows
// we write the executable the unpack reported, falling back to the folder if the
// installer carried none.
//
// The copy does NOT branch on it. An earlier draft had two versions — one framing
// this as the only route, one offering it as an alternative to the official
// installer — and the panel ended up arguing with its own buttons, which still
// said "install". One heading, one tooltip, one verb.
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
      {/* One heading and one tooltip on every platform. The copy used to branch on
          isWindows and explain the whole rationale in a paragraph; it now says what
          the control does and leaves it there. isWindows still matters below, for
          what clientPath is set to — that part is not presentation. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" color="text.button">
          Unpack the client files
        </Typography>
        <Tooltip
          title="Download the Dark Ages installer and extract the files needed by Brigid to a directory of your choosing"
          data-testid="installer-help"
        >
          <InfoOutlineIcon fontSize="inherit" sx={{ opacity: 0.6, cursor: 'help' }} />
        </Tooltip>
      </Box>

      <PathPicker
        label="Archive Storage Directory"
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
          Download and Unpack
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={busy || !destination}
          onClick={startFromFile}
          data-testid="installer-from-file"
        >
          Unpack Installer
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
