import { useState } from 'react'
import {
  Box,
  Typography,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControlLabel,
  Tooltip
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'

const THEMES = [
  { key: 'hybrasyl', label: 'Hybrasyl' },
  { key: 'chadul', label: 'Chadul' },
  { key: 'danaan', label: 'Danaan' },
  { key: 'grinneal', label: 'Grinneal' },
  { key: 'spark', label: 'Spark' }
]

const PANE_W = 360
const emptyProfile = { name: '', hostname: '', port: 2610, redirect: true }
const emptyWorldDir = { name: '', path: '' }

export default function SettingsPane({ settings, versions, onClose, onChange }) {
  const [profileDialog, setProfileDialog] = useState(null) // null | { mode, profile }
  const [worldDirDialog, setWorldDirDialog] = useState(null) // null | { mode, worldDir }

  async function browseClient() {
    try {
      const path = await window.sparkAPI.openExeDialog(settings.clientPath)
      if (path) onChange({ clientPath: path })
    } catch (err) {
      console.error('[settings] openExeDialog failed:', err)
    }
  }

  function openAddProfile() {
    setProfileDialog({ mode: 'add', profile: { ...emptyProfile, id: crypto.randomUUID() } })
  }
  function openEditProfile(profile) {
    setProfileDialog({ mode: 'edit', profile: { ...profile } })
  }
  function saveProfile(profile) {
    const profiles = [...settings.profiles]
    const idx = profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) profiles[idx] = profile
    else profiles.push(profile)
    onChange({ profiles })
    setProfileDialog(null)
  }
  function deleteProfile(id) {
    if (settings.profiles.length <= 1) return
    const profiles = settings.profiles.filter((p) => p.id !== id)
    const patch = { profiles }
    if (settings.activeProfile === id) patch.activeProfile = profiles[0].id
    onChange(patch)
  }

  // World directories — mirror profiles' add/edit/delete/active pattern.
  const worldDirInUseBy = (id) => settings.instances.filter((i) => i.worldDirectoryId === id)

  function openAddWorldDir() {
    setWorldDirDialog({
      mode: 'add',
      worldDir: { ...emptyWorldDir, id: crypto.randomUUID() }
    })
  }
  function openEditWorldDir(worldDir) {
    setWorldDirDialog({ mode: 'edit', worldDir: { ...worldDir } })
  }
  function saveWorldDir(worldDir) {
    const worldDirectories = [...settings.worldDirectories]
    const idx = worldDirectories.findIndex((w) => w.id === worldDir.id)
    if (idx >= 0) worldDirectories[idx] = worldDir
    else worldDirectories.push(worldDir)
    const patch = { worldDirectories }
    // Auto-promote the first added entry to active so new instances have a default.
    if (!settings.activeWorldDirectory) patch.activeWorldDirectory = worldDir.id
    onChange(patch)
    setWorldDirDialog(null)
  }
  function deleteWorldDir(id) {
    // The delete button is disabled when in-use, so this is a defensive guard
    // for any programmatic call.
    if (worldDirInUseBy(id).length > 0) return
    const worldDirectories = settings.worldDirectories.filter((w) => w.id !== id)
    const patch = { worldDirectories }
    if (settings.activeWorldDirectory === id) {
      patch.activeWorldDirectory = worldDirectories[0]?.id ?? null
    }
    onChange(patch)
  }
  function setActiveWorldDir(id) {
    onChange({ activeWorldDirectory: id })
  }

  return (
    <Box
      sx={{
        flex: `0 0 ${PANE_W}px`,
        height: '100%',
        bgcolor: 'background.paper',
        borderLeft: '1px solid rgba(255,255,255,0.15)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          py: 0.75,
          borderBottom: '1px solid rgba(255,255,255,0.15)'
        }}
      >
        <Typography variant="subtitle2" sx={{ pl: 0.5 }}>
          Settings
        </Typography>
        <Tooltip title="Close">
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 2
        }}
      >
        {/* Theme */}
        <FormControl fullWidth size="small">
          <InputLabel>Theme</InputLabel>
          <Select
            value={settings.theme || 'hybrasyl'}
            label="Theme"
            onChange={(e) => onChange({ theme: e.target.value })}
          >
            {THEMES.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                {t.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Divider />

        {/* Client */}
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Client Executable
          </Typography>
          <TextField
            fullWidth
            size="small"
            value={settings.clientPath}
            onChange={(e) => onChange({ clientPath: e.target.value })}
            placeholder="Path to Darkages.exe"
            inputProps={{ style: { fontSize: 12 } }}
          />
          <Button
            variant="outlined"
            size="small"
            onClick={browseClient}
            sx={{ mt: 1, width: '100%' }}
          >
            Browse
          </Button>
        </Box>

        {/* Client Version */}
        <FormControl fullWidth size="small">
          <InputLabel>Client Version</InputLabel>
          <Select
            value={settings.version}
            label="Client Version"
            onChange={(e) => onChange({ version: e.target.value })}
          >
            <MenuItem value="auto">Auto-detect</MenuItem>
            {versions.map((v) => (
              <MenuItem key={v.versionCode} value={v.versionCode}>
                {v.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Divider />

        {/* Profiles */}
        <Box>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              Server Profiles
            </Typography>
            <Tooltip title="Add profile">
              <IconButton size="small" onClick={openAddProfile}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <List dense disablePadding>
            {settings.profiles.map((p) => (
              <ListItem
                key={p.id}
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor:
                    p.id === settings.activeProfile ? 'rgba(255,255,255,0.06)' : 'transparent'
                }}
              >
                <ListItemText
                  primary={p.name}
                  secondary={p.redirect ? `${p.hostname}:${p.port}` : 'No redirect'}
                  primaryTypographyProps={{ variant: 'body2' }}
                  secondaryTypographyProps={{ variant: 'caption' }}
                />
                <ListItemSecondaryAction>
                  <IconButton size="small" onClick={() => openEditProfile(p)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => deleteProfile(p.id)}
                    disabled={settings.profiles.length <= 1}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </Box>

        <Divider />

        {/* World Directories */}
        <Box>
          <Box
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}
          >
            <Typography variant="caption" color="text.secondary">
              World Directories
            </Typography>
            <Tooltip title="Add world directory">
              <IconButton size="small" onClick={openAddWorldDir}>
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          {settings.worldDirectories.length === 0 ? (
            <Typography variant="caption" sx={{ opacity: 0.6, fontStyle: 'italic' }}>
              No world directories yet. Add one to use in a server instance.
            </Typography>
          ) : (
            <List dense disablePadding>
              {settings.worldDirectories.map((wd) => {
                const isActive = wd.id === settings.activeWorldDirectory
                const inUseCount = worldDirInUseBy(wd.id).length
                return (
                  <ListItem
                    key={wd.id}
                    sx={{
                      px: 1,
                      py: 0.5,
                      borderRadius: 1,
                      bgcolor: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                      // Reserve space for the secondary actions so long paths get
                      // ellipsis instead of overlapping the icons.
                      pr: 14
                    }}
                  >
                    <ListItemText
                      primary={wd.name}
                      secondary={wd.path}
                      primaryTypographyProps={{ variant: 'body2' }}
                      secondaryTypographyProps={{
                        variant: 'caption',
                        sx: {
                          fontFamily: 'monospace',
                          fontSize: 10,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }
                      }}
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title={isActive ? 'Default for new instances' : 'Set as default'}>
                        <IconButton size="small" onClick={() => setActiveWorldDir(wd.id)}>
                          {isActive ? (
                            <StarIcon fontSize="small" sx={{ color: 'text.button' }} />
                          ) : (
                            <StarBorderIcon fontSize="small" />
                          )}
                        </IconButton>
                      </Tooltip>
                      <IconButton size="small" onClick={() => openEditWorldDir(wd)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <Tooltip
                        title={
                          inUseCount > 0
                            ? `In use by ${inUseCount} instance${inUseCount === 1 ? '' : 's'}`
                            : 'Delete'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => deleteWorldDir(wd.id)}
                            disabled={inUseCount > 0}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                )
              })}
            </List>
          )}
        </Box>
      </Box>

      {profileDialog && (
        <ProfileDialog
          mode={profileDialog.mode}
          profile={profileDialog.profile}
          onSave={saveProfile}
          onCancel={() => setProfileDialog(null)}
        />
      )}

      {worldDirDialog && (
        <WorldDirDialog
          mode={worldDirDialog.mode}
          worldDir={worldDirDialog.worldDir}
          onSave={saveWorldDir}
          onCancel={() => setWorldDirDialog(null)}
        />
      )}
    </Box>
  )
}

function ProfileDialog({ mode, profile: initial, onSave, onCancel }) {
  const [profile, setProfile] = useState(initial)
  function patch(p) {
    setProfile((prev) => ({ ...prev, ...p }))
  }
  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>
        {mode === 'add' ? 'Add Profile' : 'Edit Profile'}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}
      >
        <TextField
          fullWidth
          size="small"
          label="Profile Name"
          value={profile.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <TextField
          fullWidth
          size="small"
          label="Hostname"
          value={profile.hostname}
          disabled={!profile.redirect}
          onChange={(e) => patch({ hostname: e.target.value })}
        />
        <TextField
          fullWidth
          size="small"
          label="Port"
          type="number"
          value={profile.port}
          disabled={!profile.redirect}
          onChange={(e) => patch({ port: Number(e.target.value) })}
          inputProps={{ min: 1, max: 65535 }}
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={profile.redirect}
              onChange={(e) => patch({ redirect: e.target.checked })}
            />
          }
          label={<Typography variant="body2">Redirect to custom server</Typography>}
        />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!profile.name.trim()}
          onClick={() => onSave(profile)}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function WorldDirDialog({ mode, worldDir: initial, onSave, onCancel }) {
  const [worldDir, setWorldDir] = useState(initial)
  const [validating, setValidating] = useState(false)
  const [pickError, setPickError] = useState(null)

  async function browse() {
    try {
      const p = await window.sparkAPI.pickDirectory('Select world directory', worldDir.path)
      if (!p) return
      setValidating(true)
      const ok = await window.sparkAPI.isHybrasylDataDir(p)
      setValidating(false)
      if (!ok) {
        setPickError(
          "Doesn't look like a Hybrasyl world data dir — should contain xml/serverconfigs/. " +
            'Pick the inner repo (e.g. world, ceridwen).'
        )
        return
      }
      setPickError(null)
      // Auto-fill the name on first browse if the user hasn't typed one.
      const segs = p
        .replace(/[\\/]+$/, '')
        .replace(/\\/g, '/')
        .split('/')
        .filter(Boolean)
      const derivedName = segs[segs.length - 1] || ''
      setWorldDir((prev) => ({
        ...prev,
        path: p,
        name: prev.name.trim() ? prev.name : derivedName
      }))
    } catch (err) {
      console.error('[settings] world-dir pickDirectory failed:', err)
      setValidating(false)
    }
  }

  const canSave = worldDir.name.trim() && worldDir.path.trim() && !pickError

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>
        {mode === 'add' ? 'Add World Directory' : 'Edit World Directory'}
      </DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}
      >
        <TextField
          fullWidth
          size="small"
          label="Name"
          value={worldDir.name}
          onChange={(e) => setWorldDir((p) => ({ ...p, name: e.target.value }))}
          placeholder="world"
        />
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            Path
          </Typography>
          <TextField
            fullWidth
            size="small"
            value={worldDir.path}
            onChange={(e) => {
              setPickError(null)
              setWorldDir((p) => ({ ...p, path: e.target.value }))
            }}
            placeholder="C:\\Hybrasyl\\world"
            inputProps={{ style: { fontFamily: 'monospace', fontSize: 11 } }}
          />
          <Button
            variant="outlined"
            size="small"
            sx={{ mt: 1, width: '100%' }}
            onClick={browse}
            disabled={validating}
          >
            {validating ? 'Validating…' : 'Browse'}
          </Button>
          {pickError && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
              {pickError}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!canSave}
          onClick={() => onSave(worldDir)}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
