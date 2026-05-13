import { useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import TerminalIcon from '@mui/icons-material/Terminal'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import FolderOpenIcon from '@mui/icons-material/FolderOpen'
import RefreshIcon from '@mui/icons-material/Refresh'

const PICKER_SX = {
  flex: 1,
  fontFamily: 'monospace',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

const CURRENT_CHECKOUT_VALUE = '__current_checkout__'
const TAB_SERVER = 0
const TAB_XML = 1
const TAB_CONFIG = 2
const TAB_NETWORK = 3

function emptyInstance(activeWorldDirectoryId) {
  return {
    id: crypto.randomUUID(),
    name: 'New Instance',
    mode: 'binary',
    binaryPath: '',
    serverRepoPath: '',
    serverBranch: null,
    xmlRepoPath: '',
    xmlBranch: null,
    worldDirectoryId: activeWorldDirectoryId ?? '',
    logDir: '',
    configFileName: '',
    redisHost: '',
    redisPort: 6379,
    redisDatabase: null,
    redisPassword: '',
    lobbyPort: 2610,
    loginPort: 2611,
    worldPort: 2612
  }
}

// Clamp a number-input's raw value to a valid port (1-65535) — falls back to
// the previous value on non-finite input so a transient empty string while
// editing doesn't blow away the field.
function clampPort(raw, fallback) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(65535, Math.floor(n)))
}

function deriveLogDir(dataDir) {
  if (!dataDir) return ''
  const sep = dataDir.includes('\\') ? '\\' : '/'
  return `${dataDir.replace(/[\\/]+$/, '')}${sep}logs`
}

function PathPicker({ label, value, onPick, disabled, extraAction }) {
  return (
    <Box>
      <Typography variant="caption" color="text.button" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ ...PICKER_SX, opacity: value ? 1 : 0.5 }}>
          {value || '(not set)'}
        </Typography>
        {onPick && (
          <Button size="small" variant="outlined" disabled={disabled} onClick={onPick}>
            Browse…
          </Button>
        )}
        {extraAction}
      </Box>
    </Box>
  )
}

export default function ServerInstancePanel({
  instances,
  selectedId,
  runningIds,
  worldDirectories,
  activeWorldDirectory,
  onSelect,
  onInstancesChange,
  onStart,
  onStop,
  onReset,
  onOpenSettings
}) {
  // null when idle; otherwise the verb shown on the busy button.
  const [busyLabel, setBusyLabel] = useState(null)
  const busy = busyLabel !== null
  const [snack, setSnack] = useState(null)
  const [activeTab, setActiveTab] = useState(TAB_SERVER)
  const [availableConfigs, setAvailableConfigs] = useState([])
  const [configDataStore, setConfigDataStore] = useState(null)
  // Branch lists keyed by repo path so switching instances doesn't refetch
  // every time. { [repoPath]: { branches, error } | undefined }
  const [branchCache, setBranchCache] = useState({})

  const selected = instances.find((i) => i.id === selectedId) ?? null
  const isRunning = selected && runningIds.has(selected.id)
  const isRepoMode = selected?.mode === 'repo'
  const useLocalXml = isRepoMode && selected?.xmlBranch !== null

  // The instance stores `worldDirectoryId` (a reference); the path itself
  // lives in the top-level worldDirectories list. Derive the resolved entry
  // and path here so downstream effects (config listing, datastore probe) and
  // the picker UI all share one source of truth.
  const selectedWorldDir = selected?.worldDirectoryId
    ? (worldDirectories.find((w) => w.id === selected.worldDirectoryId) ?? null)
    : null
  const selectedDataDir = selectedWorldDir?.path ?? ''

  useEffect(() => {
    if (!selectedDataDir) {
      setAvailableConfigs([])
      return
    }
    window.sparkAPI.listServerConfigs(selectedDataDir).then(setAvailableConfigs)
  }, [selectedDataDir])

  useEffect(() => {
    if (!selectedDataDir || !selected?.configFileName) {
      setConfigDataStore(null)
      return
    }
    window.sparkAPI.readDataStore(selectedDataDir, selected.configFileName).then(setConfigDataStore)
  }, [selectedDataDir, selected?.configFileName])

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

  // Load branches on demand for whichever repo paths the selected instance
  // uses. Initial fetch only — users hit the refresh button next to each
  // dropdown for explicit re-listing.
  useEffect(() => {
    const paths = []
    if (isRepoMode && selected?.serverRepoPath) paths.push(selected.serverRepoPath)
    if (isRepoMode && useLocalXml && selected?.xmlRepoPath) paths.push(selected.xmlRepoPath)
    for (const p of paths) {
      if (branchCache[p] !== undefined) continue
      refreshBranches(p)
    }
    // branchCache intentionally NOT in deps: entries are append-only, so the
    // closure's view is a subset of the live cache and the !== undefined check
    // still skips already-loaded paths. Including it would re-fire the effect
    // on every cache write. (The react-hooks/exhaustive-deps rule isn't active
    // in this project, so no disable comment is needed.)
  }, [isRepoMode, useLocalXml, selected?.serverRepoPath, selected?.xmlRepoPath])

  function updateSelected(patch) {
    if (!selected) return
    const next = instances.map((i) => (i.id === selected.id ? { ...i, ...patch } : i))
    onInstancesChange(next)
  }

  function addInstance() {
    const fresh = emptyInstance(activeWorldDirectory)
    onInstancesChange([...instances, fresh])
    onSelect(fresh.id)
  }

  function deleteInstance() {
    if (!selected) return
    if (isRunning) {
      setSnack({ severity: 'warning', message: 'Stop the instance before deleting' })
      return
    }
    const remaining = instances.filter((i) => i.id !== selected.id)
    onInstancesChange(remaining)
    onSelect(remaining[0]?.id ?? null)
  }

  async function handleStart() {
    if (!selected) return
    setBusyLabel('Starting…')
    const result = await onStart(selected)
    setBusyLabel(null)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Failed to start' })
  }

  async function handleStop() {
    if (!selected) return
    setBusyLabel('Stopping…')
    const result = await onStop(selected.id)
    setBusyLabel(null)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Failed to stop' })
  }

  async function handleReset() {
    if (!selected) return
    setBusyLabel('Resetting…')
    const result = await onReset(selected)
    setBusyLabel(null)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Failed to reset' })
  }

  async function pickBinary() {
    const p = await window.sparkAPI.pickFile(
      'Select Hybrasyl server binary',
      [{ name: 'Hybrasyl server (.dll or .exe)', extensions: ['dll', 'exe'] }],
      selected?.binaryPath
    )
    if (p) updateSelected({ binaryPath: p })
  }
  async function pickServerRepo() {
    const p = await window.sparkAPI.pickDirectory(
      'Select Hybrasyl server repo',
      selected?.serverRepoPath
    )
    if (!p) return
    const isRepo = await window.sparkAPI.isGitRepo(p)
    if (!isRepo) {
      setSnack({ severity: 'error', message: 'Not a git repository' })
      return
    }
    updateSelected({ serverRepoPath: p })
  }
  async function pickXmlRepo() {
    const p = await window.sparkAPI.pickDirectory('Select Hybrasyl.Xml repo', selected?.xmlRepoPath)
    if (!p) return
    const isRepo = await window.sparkAPI.isGitRepo(p)
    if (!isRepo) {
      setSnack({ severity: 'error', message: 'Not a git repository' })
      return
    }
    updateSelected({ xmlRepoPath: p })
  }
  // Apply a worldDirectoryId selection: also re-derive logDir from the matching
  // path. Note: this overwrites any manual logDir override — switching the
  // world directory always resets logDir to the derived default.
  function selectWorldDirectory(id) {
    const wd = worldDirectories.find((w) => w.id === id)
    const patch = { worldDirectoryId: id, logDir: wd ? deriveLogDir(wd.path) : '' }
    updateSelected(patch)
  }

  async function pickLogDir() {
    const p = await window.sparkAPI.pickDirectory('Select log directory', selected?.logDir)
    if (p) updateSelected({ logDir: p })
  }

  async function openLogDir() {
    if (!selected?.logDir) return
    const result = await window.sparkAPI.openPath(selected.logDir)
    if (!result.ok) {
      setSnack({ severity: 'error', message: `Could not open log dir: ${result.error}` })
    }
  }

  // Pin a saved branch into the option list even if it's not in the fetched
  // results — covers (1) the loading window before the IPC returns, (2) the
  // branch having been deleted upstream, and (3) a git error suppressing the
  // listing entirely. Without this, MUI warns "out-of-range value" and the
  // user sees an empty dropdown. `loading` distinguishes the in-flight case
  // (label "(loading…)") from completed-but-not-found ("(missing)").
  function withSavedBranchPinned(branches, savedName, loading) {
    if (!savedName || branches.some((b) => b.name === savedName)) return branches
    return [
      { name: savedName, current: false, remote: false, missing: true, loading: !!loading },
      ...branches
    ]
  }

  const serverCacheEntry = selected?.serverRepoPath ? branchCache[selected.serverRepoPath] : null
  const xmlCacheEntry = selected?.xmlRepoPath ? branchCache[selected.xmlRepoPath] : null
  const serverBranchError = serverCacheEntry?.error ?? null
  const xmlBranchError = xmlCacheEntry?.error ?? null
  const serverBranchLoading = !!serverCacheEntry?.loading
  const xmlBranchLoading = !!xmlCacheEntry?.loading
  const serverBranches = withSavedBranchPinned(
    serverCacheEntry?.branches ?? [],
    selected?.serverBranch,
    serverBranchLoading
  )
  const xmlBranches = withSavedBranchPinned(
    xmlCacheEntry?.branches ?? [],
    selected?.xmlBranch,
    xmlBranchLoading
  )

  // ──────────── Tab content sections ────────────

  const serverTab = selected && (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      <ToggleButtonGroup
        size="small"
        exclusive
        fullWidth
        value={selected.mode}
        onChange={(_, m) => m && updateSelected({ mode: m })}
        disabled={isRunning}
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
          label="Binary Path (.dll or .exe)"
          value={selected.binaryPath}
          onPick={pickBinary}
          disabled={isRunning}
        />
      )}

      {isRepoMode && (
        <>
          <PathPicker
            label="Server Repo"
            value={selected.serverRepoPath}
            onPick={pickServerRepo}
            disabled={isRunning}
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <FormControl
              size="small"
              disabled={isRunning || !selected.serverRepoPath}
              sx={{ flex: 1 }}
            >
              <InputLabel shrink>Server Branch</InputLabel>
              <Select
                label="Server Branch"
                notched
                value={selected.serverBranch ?? CURRENT_CHECKOUT_VALUE}
                onChange={(e) =>
                  updateSelected({
                    serverBranch: e.target.value === CURRENT_CHECKOUT_VALUE ? null : e.target.value
                  })
                }
              >
                <MenuItem value={CURRENT_CHECKOUT_VALUE}>(current checkout)</MenuItem>
                {serverBranches.map((b) => (
                  <MenuItem key={b.name} value={b.name}>
                    {b.name}
                    {b.current ? ' (current)' : ''}
                    {b.remote ? ' (remote)' : ''}
                    {b.missing ? (b.loading ? ' (loading…)' : ' (missing)') : ''}
                  </MenuItem>
                ))}
              </Select>
              {serverBranchError && (
                <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                  Couldn&apos;t list branches: {serverBranchError}
                </Typography>
              )}
            </FormControl>
            <Tooltip title="Refresh branch list">
              <span>
                <IconButton
                  size="small"
                  onClick={() => refreshBranches(selected.serverRepoPath)}
                  disabled={isRunning || !selected.serverRepoPath || serverBranchLoading}
                  sx={{ mt: 0.5 }}
                >
                  {serverBranchLoading ? (
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
    </Box>
  )

  const xmlTab = selected && (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      {!isRepoMode ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 1, fontStyle: 'italic' }}>
          Local Hybrasyl.Xml branches are only available in repo mode. Switch to Repo on the Server
          tab to enable.
        </Typography>
      ) : (
        <>
          <FormControlLabel
            disabled={isRunning}
            control={
              <Checkbox
                size="small"
                checked={useLocalXml}
                onChange={(e) => updateSelected({ xmlBranch: e.target.checked ? '' : null })}
              />
            }
            label={
              <Typography variant="body2">
                Use local Hybrasyl.Xml branch (instead of NuGet)
              </Typography>
            }
            sx={{ mt: -0.5, mb: -0.5 }}
          />
          {useLocalXml && (
            <>
              <PathPicker
                label="Hybrasyl.Xml Repo"
                value={selected.xmlRepoPath}
                onPick={pickXmlRepo}
                disabled={isRunning}
              />
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <FormControl
                  size="small"
                  disabled={isRunning || !selected.xmlRepoPath}
                  sx={{ flex: 1 }}
                >
                  <InputLabel shrink>XML Branch</InputLabel>
                  <Select
                    label="XML Branch"
                    notched
                    value={selected.xmlBranch ?? ''}
                    onChange={(e) => updateSelected({ xmlBranch: e.target.value })}
                    displayEmpty
                  >
                    {selected.xmlBranch === '' && (
                      <MenuItem value="" disabled>
                        (select a branch…)
                      </MenuItem>
                    )}
                    {xmlBranches.map((b) => (
                      <MenuItem key={b.name} value={b.name}>
                        {b.name}
                        {b.current ? ' (current)' : ''}
                        {b.remote ? ' (remote)' : ''}
                        {b.missing ? (b.loading ? ' (loading…)' : ' (missing)') : ''}
                      </MenuItem>
                    ))}
                  </Select>
                  {xmlBranchError && (
                    <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                      Couldn&apos;t list branches: {xmlBranchError}
                    </Typography>
                  )}
                </FormControl>
                <Tooltip title="Refresh branch list">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => refreshBranches(selected.xmlRepoPath)}
                      disabled={isRunning || !selected.xmlRepoPath || xmlBranchLoading}
                      sx={{ mt: 0.5 }}
                    >
                      {xmlBranchLoading ? (
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
        </>
      )}
    </Box>
  )

  const configTab = selected && (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      <Box>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}
        >
          <Typography variant="caption" color="text.button">
            World Directory
          </Typography>
          {onOpenSettings && (
            <Button
              size="small"
              onClick={onOpenSettings}
              sx={{ minWidth: 0, fontSize: 11, textTransform: 'none', py: 0 }}
            >
              Manage…
            </Button>
          )}
        </Box>
        <FormControl size="small" fullWidth disabled={isRunning}>
          <Select
            value={selected.worldDirectoryId || ''}
            onChange={(e) => selectWorldDirectory(e.target.value)}
            displayEmpty
          >
            {worldDirectories.length === 0 ? (
              <MenuItem value="" disabled>
                (no world directories — add one in Settings)
              </MenuItem>
            ) : (
              [
                <MenuItem key="__none" value="" disabled>
                  (select a world directory…)
                </MenuItem>,
                ...worldDirectories.map((wd) => (
                  <MenuItem key={wd.id} value={wd.id}>
                    {wd.name}
                  </MenuItem>
                ))
              ]
            )}
          </Select>
        </FormControl>
        {selectedWorldDir && (
          <Typography
            variant="caption"
            sx={{
              display: 'block',
              mt: 0.5,
              fontFamily: 'monospace',
              fontSize: 10,
              opacity: 0.7,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {selectedWorldDir.path}
          </Typography>
        )}
      </Box>
      <PathPicker
        label="Log Dir"
        value={selected.logDir}
        onPick={pickLogDir}
        disabled={isRunning}
        extraAction={
          <Tooltip title="Open log folder in Explorer">
            <span>
              <IconButton size="small" disabled={!selected.logDir} onClick={openLogDir}>
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        }
      />
      <FormControl size="small" disabled={isRunning}>
        <InputLabel shrink>Server Config</InputLabel>
        <Select
          label="Server Config"
          notched
          value={selected.configFileName}
          onChange={(e) => updateSelected({ configFileName: e.target.value })}
          displayEmpty
        >
          {selected.configFileName === '' && (
            <MenuItem value="" disabled>
              {availableConfigs.length > 0
                ? '(select a config…)'
                : selectedDataDir
                  ? '(no <ServerConfig> XMLs found in xml/serverconfigs/)'
                  : '(pick a world directory to list options)'}
            </MenuItem>
          )}
          {availableConfigs.map((name) => (
            <MenuItem key={name} value={name}>
              {name}
            </MenuItem>
          ))}
          {selected.configFileName !== '' &&
            !availableConfigs.includes(selected.configFileName) && (
              <MenuItem value={selected.configFileName} disabled>
                {selected.configFileName} (not found on disk)
              </MenuItem>
            )}
        </Select>
      </FormControl>
    </Box>
  )

  const networkTab = selected && (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      <Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size="small"
            label="Redis Host"
            placeholder="(leave blank to use config XML)"
            InputLabelProps={{ shrink: true }}
            value={selected.redisHost}
            onChange={(e) => updateSelected({ redisHost: e.target.value })}
            disabled={isRunning}
            sx={{ flex: 2 }}
          />
          <TextField
            size="small"
            label="Redis Port"
            type="number"
            value={selected.redisPort}
            onChange={(e) =>
              updateSelected({ redisPort: clampPort(e.target.value, selected.redisPort) })
            }
            disabled={isRunning}
            inputProps={{ min: 1, max: 65535 }}
            sx={{ flex: 1 }}
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
          {configDataStore && (
            <Typography variant="caption" color="text.secondary">
              Config XML says: {configDataStore.host}:{configDataStore.port}
              {configDataStore.database !== 0 ? ` / db ${configDataStore.database}` : ''}
            </Typography>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip
            title={
              <Box>
                <Typography variant="caption" sx={{ display: 'block' }}>
                  WSL Redis can drop forwarded connections under load on Windows. Memurai is a
                  native Windows Redis-compatible alternative.
                </Typography>
                <Typography
                  variant="caption"
                  sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace' }}
                >
                  winget install Memurai.MemuraiDeveloper
                </Typography>
              </Box>
            }
          >
            <HelpOutlineIcon fontSize="inherit" sx={{ opacity: 0.6, cursor: 'help' }} />
          </Tooltip>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          label="Lobby"
          type="number"
          value={selected.lobbyPort}
          onChange={(e) =>
            updateSelected({ lobbyPort: clampPort(e.target.value, selected.lobbyPort) })
          }
          disabled={isRunning}
          inputProps={{ min: 1, max: 65535 }}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Login"
          type="number"
          value={selected.loginPort}
          onChange={(e) =>
            updateSelected({ loginPort: clampPort(e.target.value, selected.loginPort) })
          }
          disabled={isRunning}
          inputProps={{ min: 1, max: 65535 }}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="World"
          type="number"
          value={selected.worldPort}
          onChange={(e) =>
            updateSelected({ worldPort: clampPort(e.target.value, selected.worldPort) })
          }
          disabled={isRunning}
          inputProps={{ min: 1, max: 65535 }}
          sx={{ flex: 1 }}
        />
      </Box>
    </Box>
  )

  return (
    <>
      {/* Instance selector row */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <FormControl size="small" sx={{ flex: 1 }}>
          <InputLabel shrink>Instance</InputLabel>
          <Select
            label="Instance"
            notched
            value={selected?.id ?? ''}
            onChange={(e) => onSelect(e.target.value)}
            displayEmpty
          >
            {instances.length === 0 && (
              <MenuItem value="" disabled>
                (no instances — click + to add)
              </MenuItem>
            )}
            {instances.map((i) => (
              <MenuItem key={i.id} value={i.id}>
                {i.name}
                {runningIds.has(i.id) && (
                  <Chip size="small" label="running" color="success" sx={{ ml: 1, height: 18 }} />
                )}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title="Add instance">
          <IconButton size="small" onClick={addInstance}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete instance">
          <span>
            <IconButton size="small" onClick={deleteInstance} disabled={!selected}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Server output goes to its own console window (interactive shutdown needs a TTY)">
          <span>
            <IconButton size="small" disabled>
              <TerminalIcon fontSize="inherit" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {selected && (
        <>
          <TextField
            size="small"
            label="Name"
            value={selected.name}
            onChange={(e) => updateSelected({ name: e.target.value })}
            disabled={isRunning}
          />

          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="fullWidth"
            sx={{
              minHeight: 32,
              '& .MuiTab-root': { minHeight: 32, textTransform: 'none', fontSize: 13 }
            }}
          >
            <Tab label="Server" />
            <Tab label="Xml" />
            <Tab label="Config" />
            <Tab label="Network" />
          </Tabs>

          <Box sx={{ flex: 1, overflow: 'auto', pt: 1 }}>
            {activeTab === TAB_SERVER && serverTab}
            {activeTab === TAB_XML && xmlTab}
            {activeTab === TAB_CONFIG && configTab}
            {activeTab === TAB_NETWORK && networkTab}
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            {isRunning ? (
              <>
                <Tooltip title="Reset (kill and relaunch — picks up script/XML changes)">
                  <span>
                    <IconButton
                      disabled={busy}
                      onClick={handleReset}
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1,
                        color: 'text.button'
                      }}
                    >
                      {busyLabel === 'Resetting…' ? (
                        <CircularProgress size={18} color="inherit" />
                      ) : (
                        <RestartAltIcon />
                      )}
                    </IconButton>
                  </span>
                </Tooltip>
                <Button
                  fullWidth
                  variant="contained"
                  color="error"
                  disabled={busy}
                  onClick={handleStop}
                  startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
                  sx={{ color: 'text.button' }}
                >
                  {busyLabel ?? 'Stop Server'}
                </Button>
              </>
            ) : (
              <Button
                fullWidth
                variant="contained"
                disabled={busy}
                onClick={handleStart}
                startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
                sx={{ color: 'text.button' }}
              >
                {busyLabel ?? 'Start Server'}
              </Button>
            )}
          </Box>
        </>
      )}

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
