import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import CircularProgress from '@mui/material/CircularProgress'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import TerminalIcon from '@mui/icons-material/Terminal'
import RefreshIcon from '@mui/icons-material/Refresh'

const CURRENT_CHECKOUT_VALUE = '__current_checkout__'

const PICKER_SX = {
  flex: 1,
  fontFamily: 'monospace',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

function PathPicker({ label, value, onPick, placeholder, chip }) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.button">
          {label}
        </Typography>
        {chip && <Chip size="small" {...chip} variant="outlined" />}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ ...PICKER_SX, opacity: value ? 1 : 0.5 }}>
          {value || placeholder}
        </Typography>
        <Button size="small" variant="outlined" onClick={onPick}>
          Browse…
        </Button>
      </Box>
    </Box>
  )
}

function kindChip(kind) {
  if (kind === 'exe') return { label: 'Prebuilt .exe', color: 'success' }
  if (kind === 'repo') return { label: 'Source (dotnet run)', color: 'info' }
  if (kind === 'invalid') return { label: 'Invalid', color: 'error' }
  return null
}

// Pin a saved branch into the option list even if it's not in the fetched
// results — covers the loading window before the IPC returns, the branch
// having been deleted, and a git error suppressing the listing entirely.
// `loading` distinguishes the in-flight case (label "(loading…)") from the
// completed-but-not-found case (label "(missing)").
function withSavedBranchPinned(branches, savedName, loading) {
  if (!savedName || branches.some((b) => b.name === savedName)) return branches
  return [
    { name: savedName, current: false, remote: false, missing: true, loading: !!loading },
    ...branches
  ]
}

export default function HybrasylClientPanel({
  hybrasyl,
  onChange,
  logPaneOpen,
  onToggleLogPane,
  activeInstanceLogDir
}) {
  const [resolution, setResolution] = useState({ kind: null })
  const [runtime, setRuntime] = useState({
    dotnetFound: null,
    netCoreApp10: null,
    sdk10: null
  })
  // Branch lists keyed by repo csproj path so flipping back and forth doesn't
  // refetch every time. { [csprojPath]: { branches, error } | undefined }
  const [branchCache, setBranchCache] = useState({})
  // Snackbar payload for the csproj-picker diagnose result. Same shape the
  // server panel uses: { severity, message, duration? }.
  const [snack, setSnack] = useState(null)

  const isRepoMode = hybrasyl.mode === 'repo'
  const activePath = isRepoMode ? hybrasyl.clientRepoPath : hybrasyl.binaryPath

  useEffect(() => {
    if (activePath) {
      window.sparkAPI
        .detectHybrasylPath(activePath)
        .then(setResolution)
        .catch((err) => console.error('[hybrasyl] detectHybrasylPath failed:', err))
    } else {
      setResolution({ kind: null })
    }
  }, [activePath])

  useEffect(() => {
    window.sparkAPI
      .checkDotnetRuntime()
      .then(setRuntime)
      .catch((err) => console.error('[hybrasyl] checkDotnetRuntime failed:', err))
  }, [])

  // Refetch branches for a repo path. Marks the entry loading so the UI can
  // show a spinner and avoid mislabeling missing branches as "(loading…)".
  function refreshBranches(p) {
    if (!p) return
    setBranchCache((prev) => ({
      ...prev,
      [p]: { branches: prev[p]?.branches ?? [], error: null, loading: true }
    }))
    window.sparkAPI.listGitBranches(p).then((result) => {
      setBranchCache((prev) => ({
        ...prev,
        [p]: result.ok
          ? { branches: result.branches, error: null, loading: false }
          : { branches: [], error: result.error, loading: false }
      }))
    })
  }

  // Fetch branches whenever a csproj is configured in repo mode. Cached by
  // path so flipping mode or pasting the same path twice doesn't refetch
  // automatically — the user gets a refresh button for that. Skipped entirely
  // when hybrasyl.noGit is set: branch switching is unavailable there and
  // listBranches would just bounce with a "Not a git repository" error.
  useEffect(() => {
    if (!isRepoMode || !hybrasyl.clientRepoPath || hybrasyl.noGit) return
    const p = hybrasyl.clientRepoPath
    if (branchCache[p] !== undefined) return
    refreshBranches(p)
    // branchCache intentionally omitted — entries are append-only and the
    // !== undefined guard already short-circuits, so including it would just
    // re-run the effect on every cache write.
  }, [isRepoMode, hybrasyl.clientRepoPath, hybrasyl.noGit])

  function setMode(m) {
    if (!m || m === hybrasyl.mode) return
    onChange({ targets: { hybrasyl: { ...hybrasyl, mode: m } } })
  }

  async function pickBinary() {
    try {
      const path = await window.sparkAPI.pickFile(
        'Select Hybrasyl client binary',
        [{ name: 'Hybrasyl client (.exe)', extensions: ['exe'] }],
        hybrasyl.binaryPath
      )
      if (path) onChange({ targets: { hybrasyl: { ...hybrasyl, binaryPath: path } } })
    } catch (err) {
      console.error('[hybrasyl] pickBinary failed:', err)
    }
  }

  // Map a diagnoseGitRepo result to a snackbar payload + which fields to set.
  // Mirrors the server panel's helper so the two pickers stay in lockstep.
  async function diagnoseAndExplain(p) {
    const diag = await window.sparkAPI.diagnoseGitRepo(p)
    if (diag.ok) return { accept: true, noGit: false, snack: null }
    if (diag.reason === 'no_git') {
      return {
        accept: true,
        noGit: true,
        snack: {
          severity: 'warning',
          duration: 10000,
          message:
            'Git not detected on PATH. Branch switching disabled. ' +
            'Install: winget install --id Git.Git -e (then restart Epona).'
        }
      }
    }
    if (diag.reason === 'not_repo') {
      return {
        accept: true,
        noGit: true,
        snack: {
          severity: 'warning',
          duration: 8000,
          message:
            'No .git/ found in this folder or its parents. Branch switching disabled — ' +
            'running directly from the picked .csproj.'
        }
      }
    }
    if (diag.reason === 'no_path') {
      return {
        accept: false,
        noGit: false,
        snack: { severity: 'error', message: "Folder doesn't exist or isn't accessible." }
      }
    }
    return {
      accept: false,
      noGit: false,
      snack: { severity: 'error', message: `Git error: ${diag.message ?? 'unknown'}` }
    }
  }

  async function pickCsproj() {
    try {
      const path = await window.sparkAPI.pickFile(
        'Select Hybrasyl client .csproj',
        [{ name: 'C# Project', extensions: ['csproj'] }],
        hybrasyl.clientRepoPath
      )
      if (!path) return
      const { accept, noGit, snack: snackPayload } = await diagnoseAndExplain(path)
      if (snackPayload) setSnack(snackPayload)
      if (!accept) return
      // Reset clientBranch on any csproj change — pinning a branch from the old
      // repo into the new one yields "missing" labels forever otherwise. When
      // noGit, null also matches the "current checkout" sentinel the launcher
      // treats as "use the picked dir in place".
      onChange({
        targets: {
          hybrasyl: { ...hybrasyl, clientRepoPath: path, clientBranch: null, noGit }
        }
      })
    } catch (err) {
      console.error('[hybrasyl] pickCsproj failed:', err)
    }
  }

  // Console pane is only meaningful for source/dotnet-run launches — exe
  // launches are fire-and-forget with no stdio pipes (multi-instance allowed).
  const consoleAvailable = isRepoMode
  const consoleTooltip = consoleAvailable
    ? logPaneOpen
      ? 'Hide console'
      : 'Show console'
    : 'Console output is only available for source (.csproj) launches'

  // Repo (.csproj) launches need both runtime AND SDK. Binary (.exe / .dll)
  // launches only need the runtime. The chip shape distinguishes the cases so
  // the user can tell which install they're missing from a glance.
  const needsSdk = isRepoMode
  const runtimeOk = runtime.netCoreApp10 === true && (!needsSdk || runtime.sdk10 === true)
  const runtimeChip = (() => {
    if (runtime.dotnetFound === null) return { label: 'Checking .NET…', color: 'default' }
    if (!runtime.dotnetFound) return { label: '.NET not installed', color: 'error' }
    if (runtimeOk) {
      return needsSdk
        ? { label: '.NET 10 runtime + SDK', color: 'success' }
        : { label: '.NET 10 runtime', color: 'success' }
    }
    if (needsSdk && !runtime.sdk10 && runtime.netCoreApp10) {
      return { label: '.NET 10 SDK missing', color: 'warning' }
    }
    if (needsSdk && !runtime.sdk10 && !runtime.netCoreApp10) {
      return { label: '.NET 10 runtime + SDK missing', color: 'warning' }
    }
    return { label: '.NET 10 runtime missing', color: 'warning' }
  })()

  const cacheEntry = hybrasyl.clientRepoPath ? branchCache[hybrasyl.clientRepoPath] : null
  const branchError = cacheEntry?.error ?? null
  const branchLoading = !!cacheEntry?.loading
  const branches = withSavedBranchPinned(
    cacheEntry?.branches ?? [],
    hybrasyl.clientBranch,
    branchLoading
  )
  const resolvedChip = activePath ? kindChip(resolution.kind) : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={hybrasyl.mode}
        onChange={(_, m) => setMode(m)}
      >
        <ToggleButton value="binary" sx={{ textTransform: 'none' }}>
          Binary
        </ToggleButton>
        <ToggleButton value="repo" sx={{ textTransform: 'none' }}>
          Repo
        </ToggleButton>
      </ToggleButtonGroup>

      {!isRepoMode && (
        <PathPicker
          label="Binary Path (.exe)"
          value={hybrasyl.binaryPath}
          onPick={pickBinary}
          placeholder="(none — pick a client .exe)"
          chip={resolvedChip}
        />
      )}

      {isRepoMode && (
        <>
          <PathPicker
            label="Client Repo (.csproj)"
            value={hybrasyl.clientRepoPath}
            onPick={pickCsproj}
            placeholder="(none — pick a client .csproj)"
            chip={resolvedChip}
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <FormControl
              size="small"
              disabled={!hybrasyl.clientRepoPath || hybrasyl.noGit}
              sx={{ flex: 1 }}
            >
              <InputLabel shrink>Client Branch</InputLabel>
              <Select
                label="Client Branch"
                notched
                value={hybrasyl.clientBranch ?? CURRENT_CHECKOUT_VALUE}
                onChange={(e) =>
                  onChange({
                    targets: {
                      hybrasyl: {
                        ...hybrasyl,
                        clientBranch:
                          e.target.value === CURRENT_CHECKOUT_VALUE ? null : e.target.value
                      }
                    }
                  })
                }
                onOpen={() =>
                  !hybrasyl.noGit &&
                  hybrasyl.clientRepoPath &&
                  refreshBranches(hybrasyl.clientRepoPath)
                }
              >
                <MenuItem value={CURRENT_CHECKOUT_VALUE}>(current checkout)</MenuItem>
                {branches.map((b) => (
                  <MenuItem key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? ' (current)' : ''}
                    {b.remote ? ' (remote)' : ''}
                    {b.missing ? (b.loading ? ' (loading…)' : ' (missing)') : ''}
                  </MenuItem>
                ))}
              </Select>
              {hybrasyl.noGit ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.5, fontStyle: 'italic' }}
                >
                  Git not available — client runs directly from the picked .csproj.
                </Typography>
              ) : (
                branchError && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                    Couldn&apos;t list branches: {branchError}
                  </Typography>
                )
              )}
            </FormControl>
            <Tooltip title={hybrasyl.noGit ? 'Git not available' : 'Refresh branch list'}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => refreshBranches(hybrasyl.clientRepoPath)}
                  disabled={!hybrasyl.clientRepoPath || branchLoading || hybrasyl.noGit}
                  sx={{ mt: 0.5 }}
                >
                  {branchLoading ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </>
      )}

      {resolution.kind === 'invalid' && resolution.reason && (
        <Typography variant="caption" color="error">
          {resolution.reason}
        </Typography>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" color="text.button">
          Runtime
        </Typography>
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

      <Tooltip
        title={
          activeInstanceLogDir
            ? `Saves to ${activeInstanceLogDir} on client exit`
            : 'No active server instance with a log directory — set one on the Server tab'
        }
      >
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={!!hybrasyl.autoSaveLogs && !!activeInstanceLogDir}
              disabled={!activeInstanceLogDir}
              onChange={(e) =>
                onChange({
                  targets: { hybrasyl: { ...hybrasyl, autoSaveLogs: e.target.checked } }
                })
              }
            />
          }
          label={
            <Typography variant="body2">Automatically save logfiles to server logs</Typography>
          }
          sx={{ m: 0 }}
        />
      </Tooltip>

      <Snackbar
        open={!!snack}
        autoHideDuration={snack?.duration ?? 4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack?.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
          {snack?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
