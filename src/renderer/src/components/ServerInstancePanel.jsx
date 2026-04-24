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
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import TerminalIcon from '@mui/icons-material/Terminal'

const PICKER_SX = {
  flex: 1,
  fontFamily: 'monospace',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis'
}

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
    worldDataDir: '',
    logDir: '',
    configFileName: '',
    // Redis fields default to "don't override" — the server reads <DataStore>
    // from the selected config XML. Populate to force a per-instance override.
    redisHost: '',
    redisPort: 6379,
    redisDatabase: null,
    redisPassword: '',
    lobbyPort: 2610,
    loginPort: 2611,
    worldPort: 2612
  }
}

// Convention: the server writes Serilog output under the world data dir by
// default. We auto-fill logDir on first pick; user can still override.
function deriveLogDirFromWorld(worldDataDir) {
  if (!worldDataDir) return ''
  const sep = worldDataDir.includes('\\') ? '\\' : '/'
  return `${worldDataDir.replace(/[\\/]+$/, '')}${sep}logs`
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
  const [availableConfigs, setAvailableConfigs] = useState([])
  const [configDataStore, setConfigDataStore] = useState(null)

  const selected = instances.find((i) => i.id === selectedId) ?? null
  const isRunning = selected && runningIds.has(selected.id)

  useEffect(() => {
    if (!selected?.worldDataDir) {
      setAvailableConfigs([])
      return
    }
    window.sparkAPI.listServerConfigs(selected.worldDataDir).then(setAvailableConfigs)
  }, [selected?.worldDataDir])

  useEffect(() => {
    if (!selected?.worldDataDir || !selected?.configFileName) {
      setConfigDataStore(null)
      return
    }
    window.sparkAPI
      .readDataStore(selected.worldDataDir, selected.configFileName)
      .then(setConfigDataStore)
  }, [selected?.worldDataDir, selected?.configFileName])

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
  async function pickWorldDataDir() {
    const p = await window.sparkAPI.pickDirectory('Select world data directory')
    if (!p) return
    const patch = { worldDataDir: p }
    // Auto-fill logDir on first pick so users don't have to wire it up twice.
    if (!selected.logDir) patch.logDir = deriveLogDirFromWorld(p)
    updateSelected(patch)
  }
  async function pickLogDir() {
    const p = await window.sparkAPI.pickDirectory('Select log directory')
    if (p) updateSelected({ logDir: p })
  }

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

      {/* Detail form — only visible when an instance is selected */}
      {selected && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.2, flex: 1, overflow: 'auto' }}>
          <TextField
            size="small"
            label="Name"
            value={selected.name}
            onChange={(e) => updateSelected({ name: e.target.value })}
            disabled={isRunning}
          />

          <Box>
            <Typography variant="caption" color="text.button" sx={{ display: 'block', mb: 0.5 }}>
              Binary Path (.dll or .exe)
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography
                variant="body2"
                sx={{ ...PICKER_SX, opacity: selected.binaryPath ? 1 : 0.5 }}
              >
                {selected.binaryPath || '(not set)'}
              </Typography>
              <Button size="small" variant="outlined" disabled={isRunning} onClick={pickBinary}>
                Browse…
              </Button>
            </Box>
          </Box>

          <Box>
            <Typography variant="caption" color="text.button" sx={{ display: 'block', mb: 0.5 }}>
              World Data Dir
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography
                variant="body2"
                sx={{ ...PICKER_SX, opacity: selected.worldDataDir ? 1 : 0.5 }}
              >
                {selected.worldDataDir || '(not set)'}
              </Typography>
              <Button
                size="small"
                variant="outlined"
                disabled={isRunning}
                onClick={pickWorldDataDir}
              >
                Browse…
              </Button>
            </Box>
          </Box>

          <Box>
            <Typography variant="caption" color="text.button" sx={{ display: 'block', mb: 0.5 }}>
              Log Dir
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Typography
                variant="body2"
                sx={{ ...PICKER_SX, opacity: selected.logDir ? 1 : 0.5 }}
              >
                {selected.logDir || '(not set)'}
              </Typography>
              <Button size="small" variant="outlined" disabled={isRunning} onClick={pickLogDir}>
                Browse…
              </Button>
            </Box>
          </Box>

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
                    : selected.worldDataDir
                      ? '(no <ServerConfig> XMLs found in xml/serverconfigs/)'
                      : '(pick a world data dir to list options)'}
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
            {configDataStore && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Config XML says: {configDataStore.host}:{configDataStore.port}
                {configDataStore.database !== 0 ? ` / db ${configDataStore.database}` : ''}
              </Typography>
            )}
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

          <Box sx={{ flex: 1 }} />

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
        </Box>
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
