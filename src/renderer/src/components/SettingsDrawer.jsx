import { useState } from 'react'
import {
  Drawer,
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
  FormControlLabel
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'

const THEMES = [
  { key: 'hybrasyl', label: 'Hybrasyl' },
  { key: 'chadul', label: 'Chadul' },
  { key: 'danaan', label: 'Danaan' },
  { key: 'grinneal', label: 'Grinneal' },
  { key: 'spark', label: 'Spark' }
]

const emptyProfile = { name: '', hostname: '', port: 2610, redirect: true }

export default function SettingsDrawer({ open, settings, versions, onClose, onChange }) {
  const [profileDialog, setProfileDialog] = useState(null) // null | { mode: 'add'|'edit', profile }

  async function browseClient() {
    const path = await window.sparkAPI.openExeDialog()
    if (path) onChange({ clientPath: path })
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
    if (idx >= 0) {
      profiles[idx] = profile
    } else {
      profiles.push(profile)
    }
    onChange({ profiles })
    setProfileDialog(null)
  }

  function deleteProfile(id) {
    if (settings.profiles.length <= 1) return
    const profiles = settings.profiles.filter((p) => p.id !== id)
    const patch = { profiles }
    if (settings.activeProfile === id) {
      patch.activeProfile = profiles[0].id
    }
    onChange(patch)
  }

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: 300,
            bgcolor: 'background.paper',
            p: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            overflow: 'auto'
          }
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" sx={{ fontSize: '1rem' }}>
            Settings
          </Typography>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Divider />

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
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Server Profiles
            </Typography>
            <IconButton size="small" onClick={openAddProfile}>
              <AddIcon fontSize="small" />
            </IconButton>
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
                    p.id === settings.activeProfile
                      ? 'rgba(255,255,255,0.06)'
                      : 'transparent'
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
      </Drawer>

      {/* Profile Add/Edit Dialog */}
      {profileDialog && (
        <ProfileDialog
          mode={profileDialog.mode}
          profile={profileDialog.profile}
          onSave={saveProfile}
          onCancel={() => setProfileDialog(null)}
        />
      )}
    </>
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
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
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
