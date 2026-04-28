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
import TerminalIcon from '@mui/icons-material/Terminal'

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
function withSavedBranchPinned(branches, savedName) {
  if (!savedName || branches.some((b) => b.name === savedName)) return branches
  return [{ name: savedName, current: false, remote: false, missing: true }, ...branches]
}

export default function HybrasylClientPanel({ hybrasyl, onChange, logPaneOpen, onToggleLogPane }) {
  const [resolution, setResolution] = useState({ kind: null })
  const [runtime, setRuntime] = useState({ dotnetFound: null, netCoreApp10: null })
  // Branch lists keyed by repo csproj path so flipping back and forth doesn't
  // refetch every time. { [csprojPath]: { branches, error } | undefined }
  const [branchCache, setBranchCache] = useState({})

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

  // Fetch branches whenever a csproj is configured in repo mode. Cached by
  // path so flipping mode or pasting the same path twice doesn't refetch.
  useEffect(() => {
    if (!isRepoMode || !hybrasyl.clientRepoPath) return
    const p = hybrasyl.clientRepoPath
    if (branchCache[p] !== undefined) return
    window.sparkAPI.listGitBranches(p).then((result) => {
      setBranchCache((prev) => {
        if (prev[p] !== undefined) return prev
        return {
          ...prev,
          [p]: result.ok
            ? { branches: result.branches, error: null }
            : { branches: [], error: result.error }
        }
      })
    })
    // branchCache intentionally omitted — entries are append-only and the
    // !== undefined guard already short-circuits, so including it would just
    // re-run the effect on every cache write.
  }, [isRepoMode, hybrasyl.clientRepoPath])

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

  async function pickCsproj() {
    try {
      const path = await window.sparkAPI.pickFile(
        'Select Hybrasyl client .csproj',
        [{ name: 'C# Project', extensions: ['csproj'] }],
        hybrasyl.clientRepoPath
      )
      if (path) {
        // Reset branch when the csproj changes — the saved branch belongs to
        // a different repo and would be pinned-as-missing forever otherwise.
        onChange({
          targets: {
            hybrasyl: { ...hybrasyl, clientRepoPath: path, clientBranch: null }
          }
        })
      }
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

  const runtimeOk = runtime.netCoreApp10 === true
  const runtimeChip =
    runtime.dotnetFound === null
      ? { label: 'Checking .NET…', color: 'default' }
      : runtimeOk
        ? { label: '.NET 10 detected', color: 'success' }
        : runtime.dotnetFound
          ? { label: '.NET 10 missing', color: 'warning' }
          : { label: '.NET not installed', color: 'error' }

  const cacheEntry = hybrasyl.clientRepoPath ? branchCache[hybrasyl.clientRepoPath] : null
  const branchError = cacheEntry?.error ?? null
  const branches = withSavedBranchPinned(cacheEntry?.branches ?? [], hybrasyl.clientBranch)
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
          <FormControl size="small" disabled={!hybrasyl.clientRepoPath}>
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
            >
              <MenuItem value={CURRENT_CHECKOUT_VALUE}>(current checkout)</MenuItem>
              {branches.map((b) => (
                <MenuItem key={b.name} value={b.name}>
                  {b.name}
                  {b.current ? ' (current)' : ''}
                  {b.remote ? ' (remote)' : ''}
                  {b.missing ? ' (loading…)' : ''}
                </MenuItem>
              ))}
            </Select>
            {branchError && (
              <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                Couldn&apos;t list branches: {branchError}
              </Typography>
            )}
          </FormControl>
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
