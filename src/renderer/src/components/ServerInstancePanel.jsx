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

function emptyInstance() {
  return {
    id: crypto.randomUUID(),
    name: 'New Instance',
    mode: 'binary',
    binaryPath: '',
    serverRepoPath: '',
    serverBranch: null,
    xmlRepoPath: '',
    xmlBranch: null,
    dataDir: '',
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

function deriveLogDir(dataDir) {
  if (!dataDir) return ''
  const sep = dataDir.includes('\\') ? '\\' : '/'
  return `${dataDir.replace(/[\\/]+$/, '')}${sep}logs`
}

function PathPicker({ label, value, onPick, disabled }) {
  return (
    <Box>
      <Typography variant="caption" color="text.button" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ ...PICKER_SX, opacity: value ? 1 : 0.5 }}>
          {value || '(not set)'}
        </Typography>
        <Button size="small" variant="outlined" disabled={disabled} onClick={onPick}>
          Browse…
        </Button>
      </Box>
    </Box>
  )
}

export default function ServerInstancePanel({
  instances,
  selectedId,
  runningIds,
  onSelect,
  onInstancesChange,
  onStart,
  onStop,
  logPaneOpen,
  onToggleLogPane
}) {
  const [busy, setBusy] = useState(false)
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

  useEffect(() => {
    if (!selected?.dataDir) {
      setAvailableConfigs([])
      return
    }
    window.sparkAPI.listServerConfigs(selected.dataDir).then(setAvailableConfigs)
  }, [selected?.dataDir])

  useEffect(() => {
    if (!selected?.dataDir || !selected?.configFileName) {
      setConfigDataStore(null)
      return
    }
    window.sparkAPI
      .readDataStore(selected.dataDir, selected.configFileName)
      .then(setConfigDataStore)
  }, [selected?.dataDir, selected?.configFileName])

  // Load branches on demand for whichever repo paths the selected instance uses.
  useEffect(() => {
    const paths = []
    if (isRepoMode && selected?.serverRepoPath) paths.push(selected.serverRepoPath)
    if (isRepoMode && useLocalXml && selected?.xmlRepoPath) paths.push(selected.xmlRepoPath)
    for (const p of paths) {
      if (branchCache[p] !== undefined) continue
      window.sparkAPI.listGitBranches(p).then((result) => {
        setBranchCache((prev) => ({
          ...prev,
          [p]: result.ok
            ? { branches: result.branches, error: null }
            : { branches: [], error: result.error }
        }))
      })
    }
  }, [isRepoMode, useLocalXml, selected?.serverRepoPath, selected?.xmlRepoPath, branchCache])

  function updateSelected(patch) {
    if (!selected) return
    const next = instances.map((i) => (i.id === selected.id ? { ...i, ...patch } : i))
    onInstancesChange(next)
  }

  function addInstance() {
    const fresh = emptyInstance()
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
    setBusy(true)
    const result = await onStart(selected)
    setBusy(false)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Failed to start' })
  }

  async function handleStop() {
    if (!selected) return
    setBusy(true)
    const result = await onStop(selected.id)
    setBusy(false)
    if (!result.success) setSnack({ severity: 'error', message: result.error ?? 'Failed to stop' })
  }

  async function pickBinary() {
    const p = await window.sparkAPI.pickFile('Select Hybrasyl server binary', [
      { name: 'Hybrasyl server (.dll or .exe)', extensions: ['dll', 'exe'] }
    ])
    if (p) updateSelected({ binaryPath: p })
  }
  async function pickServerRepo() {
    const p = await window.sparkAPI.pickDirectory('Select Hybrasyl server repo')
    if (!p) return
    const isRepo = await window.sparkAPI.isGitRepo(p)
    if (!isRepo) {
      setSnack({ severity: 'error', message: 'Not a git repository' })
      return
    }
    updateSelected({ serverRepoPath: p })
  }
  async function pickXmlRepo() {
    const p = await window.sparkAPI.pickDirectory('Select Hybrasyl.Xml repo')
    if (!p) return
    const isRepo = await window.sparkAPI.isGitRepo(p)
    if (!isRepo) {
      setSnack({ severity: 'error', message: 'Not a git repository' })
      return
    }
    updateSelected({ xmlRepoPath: p })
  }
  async function pickDataDir() {
    const p = await window.sparkAPI.pickDirectory('Select data directory')
    if (!p) return
    const patch = { dataDir: p }
    if (!selected.logDir) patch.logDir = deriveLogDir(p)
    updateSelected(patch)
  }
  async function pickLogDir() {
    const p = await window.sparkAPI.pickDirectory('Select log directory')
    if (p) updateSelected({ logDir: p })
  }

  const serverBranches = (selected?.serverRepoPath && branchCache[selected.serverRepoPath]?.branches) || []
  const xmlBranches = (selected?.xmlRepoPath && branchCache[selected.xmlRepoPath]?.branches) || []

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
        <ToggleButton value="binary" sx={{ textTransform: 'none' }}>Binary</ToggleButton>
        <ToggleButton value="repo" sx={{ textTransform: 'none' }}>Repo</ToggleButton>
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
          <FormControl size="small" disabled={isRunning || !selected.serverRepoPath}>
            <InputLabel shrink>Server Branch</InputLabel>
            <Select
              label="Server Branch"
              notched
              value={selected.serverBranch ?? CURRENT_CHECKOUT_VALUE}
              onChange={(e) => updateSelected({
                serverBranch: e.target.value === CURRENT_CHECKOUT_VALUE ? null : e.target.value
              })}
            >
              <MenuItem value={CURRENT_CHECKOUT_VALUE}>(current checkout)</MenuItem>
              {serverBranches.map((b) => (
                <MenuItem key={b.name} value={b.name}>
                  {b.name}{b.current ? ' (current)' : ''}{b.remote ? ' (remote)' : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </>
      )}
    </Box>
  )

  const xmlTab = selected && (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      {!isRepoMode ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 1, fontStyle: 'italic' }}>
          Local Hybrasyl.Xml branches are only available in repo mode. Switch to Repo on the
          Server tab to enable.
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
              <FormControl size="small" disabled={isRunning || !selected.xmlRepoPath}>
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
                      {b.name}{b.current ? ' (current)' : ''}{b.remote ? ' (remote)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}
        </>
      )}
    </Box>
  )

  const configTab = selected && (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2 }}>
      <PathPicker
        label="Data Dir"
        value={selected.dataDir}
        onPick={pickDataDir}
        disabled={isRunning}
      />
      <PathPicker
        label="Log Dir"
        value={selected.logDir}
        onPick={pickLogDir}
        disabled={isRunning}
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
                : selected.dataDir
                  ? '(no <ServerConfig> XMLs found in xml/serverconfigs/)'
                  : '(pick a data dir to list options)'}
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
              updateSelected({ redisPort: Number(e.target.value) || selected.redisPort })
            }
            disabled={isRunning}
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
                  WSL Redis can drop forwarded connections under load on Windows.
                  Memurai is a native Windows Redis-compatible alternative.
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
            updateSelected({ lobbyPort: Number(e.target.value) || selected.lobbyPort })
          }
          disabled={isRunning}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Login"
          type="number"
          value={selected.loginPort}
          onChange={(e) =>
            updateSelected({ loginPort: Number(e.target.value) || selected.loginPort })
          }
          disabled={isRunning}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="World"
          type="number"
          value={selected.worldPort}
          onChange={(e) =>
            updateSelected({ worldPort: Number(e.target.value) || selected.worldPort })
          }
          disabled={isRunning}
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
              <Button
                fullWidth
                variant="contained"
                color="error"
                disabled={busy}
                onClick={handleStop}
                startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
                sx={{ color: 'text.button' }}
              >
                {busy ? 'Stopping…' : 'Stop Server'}
              </Button>
            ) : (
              <Button
                fullWidth
                variant="contained"
                disabled={busy}
                onClick={handleStart}
                startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
                sx={{ color: 'text.button' }}
              >
                {busy ? 'Starting…' : 'Start Server'}
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
