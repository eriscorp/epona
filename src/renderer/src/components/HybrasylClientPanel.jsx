import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import TerminalIcon from '@mui/icons-material/Terminal'
import PathPicker from './PathPicker'
import BranchSelector from './BranchSelector'
import SnackbarHost from './SnackbarHost'
import { useGitBranches, deriveBranchOptions } from '../useGitBranches'
import { useDotnetRuntime } from '../useDotnetRuntime'
import { diagnoseAndExplain } from '../gitDiagnose'
import { runtimeChip } from '../runtimeChip'

function kindChip(kind) {
  if (kind === 'exe') return { label: 'Prebuilt binary', color: 'success' }
  if (kind === 'dll') return { label: 'Prebuilt .dll (dotnet)', color: 'success' }
  if (kind === 'repo') return { label: 'Source (dotnet run)', color: 'info' }
  if (kind === 'invalid') return { label: 'Invalid', color: 'error' }
  return null
}

export default function HybrasylClientPanel({
  hybrasyl,
  onChange,
  logPaneOpen,
  onToggleLogPane,
  activeInstanceLogDir
}) {
  const [resolution, setResolution] = useState({ kind: null })
  const runtime = useDotnetRuntime()
  // Branch lists keyed by repo csproj path so flipping back and forth doesn't
  // refetch every time. { [csprojPath]: { branches, error } | undefined }
  const { branchCache, refreshBranches } = useGitBranches()
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
    // branchCache/refreshBranches intentionally omitted — cache entries are
    // append-only and the !== undefined guard short-circuits, so including them
    // would just re-run the effect on every cache write / render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRepoMode, hybrasyl.clientRepoPath, hybrasyl.noGit])

  function setMode(m) {
    if (!m || m === hybrasyl.mode) return
    onChange({ targets: { hybrasyl: { ...hybrasyl, mode: m } } })
  }

  async function pickBinary() {
    try {
      // On Windows the client binary is always a .exe; on macOS/Linux it's an
      // extension-less apphost (e.g. `GameClient`) or a framework-dependent
      // .dll, so don't gate the picker to .exe there.
      const filters =
        window.sparkAPI.platform === 'win32'
          ? [{ name: 'Hybrasyl client (.exe)', extensions: ['exe'] }]
          : [
              { name: 'Hybrasyl client', extensions: ['*'] },
              { name: '.NET assembly (.dll)', extensions: ['dll'] }
            ]
      const path = await window.sparkAPI.pickFile(
        'Select Hybrasyl client binary',
        filters,
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
      if (!path) return
      const {
        accept,
        noGit,
        snack: snackPayload
      } = await diagnoseAndExplain(path, {
        notRepoNoun: 'running directly from the picked .csproj.'
      })
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
  const chip = runtimeChip(runtime, { needsSdk })

  const {
    branches,
    error: branchError,
    loading: branchLoading
  } = deriveBranchOptions(branchCache, hybrasyl.clientRepoPath, hybrasyl.clientBranch)
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
          label={window.sparkAPI.platform === 'win32' ? 'Binary Path (.exe)' : 'Binary Path'}
          value={hybrasyl.binaryPath}
          onPick={pickBinary}
          placeholder={
            window.sparkAPI.platform === 'win32'
              ? '(none — pick a client .exe)'
              : '(none — pick a client binary or .dll)'
          }
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
          <BranchSelector
            label="Client Branch"
            value={hybrasyl.clientBranch}
            branches={branches}
            disabled={!hybrasyl.clientRepoPath || hybrasyl.noGit}
            loading={branchLoading}
            noGit={hybrasyl.noGit}
            error={branchError}
            onChange={(v) => onChange({ targets: { hybrasyl: { ...hybrasyl, clientBranch: v } } })}
            onOpen={() =>
              !hybrasyl.noGit && hybrasyl.clientRepoPath && refreshBranches(hybrasyl.clientRepoPath)
            }
            onRefresh={() => refreshBranches(hybrasyl.clientRepoPath)}
            allowCurrentCheckout
            noGitText="Git not available — client runs directly from the picked .csproj."
          />
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
        <Chip size="small" label={chip.label} color={chip.color} variant="outlined" />
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

      <SnackbarHost snack={snack} onClose={() => setSnack(null)} />
    </Box>
  )
}
