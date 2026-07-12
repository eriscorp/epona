import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  Link,
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
  Tooltip,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import AddIcon from '@mui/icons-material/Add'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import StarIcon from '@mui/icons-material/Star'
import StarBorderIcon from '@mui/icons-material/StarBorder'
import { PANEL_BORDER } from '../uiConstants.js'
import { basenameOfPath } from '../../../shared/pathBasename.js'
import { detectProtectedLocation } from '../../../shared/protectedPaths.js'

const THEMES = [
  { key: 'hybrasyl', label: 'Hybrasyl' },
  { key: 'chadul', label: 'Chadul' },
  { key: 'danaan', label: 'Danaan' },
  { key: 'grinneal', label: 'Grinneal' },
  { key: 'spark', label: 'Spark' },
  { key: 'mundanes', label: 'Mundanes' }
]

const PANE_W = 360
const emptyProfile = { name: '', hostname: '', port: 2610, redirect: true }
const emptyWorldDir = { name: '', path: '' }

// Shared styling for the settings accordions — flat (no elevation or rounded
// corners), transparent so the pane background shows through, separated by a
// bottom border instead of MUI's default drop shadow.
const ACCORDION_SX = {
  bgcolor: 'transparent',
  borderBottom: PANEL_BORDER,
  '&:before': { display: 'none' }
}
const SUMMARY_SX = { '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center' } }
// Subtle highlight for the active row in the profiles / world-directory lists.
const ACTIVE_ROW_BG = 'rgba(255,255,255,0.06)'

// One collapsible settings section. Owns the repeated Accordion/Summary
// boilerplate (flat styling, single-open wiring, expand icon); the parent
// passes the shared `expanded` state + `onToggle` (handleAccordion). `action`
// renders a right-aligned control in the header (e.g. an Add button, which
// must stopPropagation so it doesn't toggle the accordion); `detailsSx` styles
// the body container.
function SettingsSection({ panel, title, expanded, onToggle, action, detailsSx, children }) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      square
      expanded={expanded === panel}
      onChange={onToggle(panel)}
      sx={ACCORDION_SX}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={SUMMARY_SX}>
        {action ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexGrow: 1,
              mr: 1
            }}
          >
            <Typography variant="subtitle2">{title}</Typography>
            {action}
          </Box>
        ) : (
          <Typography variant="subtitle2">{title}</Typography>
        )}
      </AccordionSummary>
      <AccordionDetails sx={detailsSx}>{children}</AccordionDetails>
    </Accordion>
  )
}

export default function SettingsPane({ settings, versions, onClose, onChange }) {
  const [profileDialog, setProfileDialog] = useState(null) // null | { mode, profile }
  const [worldDirDialog, setWorldDirDialog] = useState(null) // null | { mode, worldDir }
  const [flushConfirm, setFlushConfirm] = useState(false)
  const [flushing, setFlushing] = useState(false)
  const [flushResult, setFlushResult] = useState(null) // null | { ok, repos, removed, errors }
  // Single-open accordion: only one section is expanded at a time. `false`
  // collapses all (clicking the open section closes it). Defaults to Theme.
  const [expanded, setExpanded] = useState('theme')
  const handleAccordion = (panel) => (_, isExpanded) => setExpanded(isExpanded ? panel : false)
  // App version for the About section — resolved from the main process on mount.
  const [version, setVersion] = useState('')
  useEffect(() => {
    window.sparkAPI
      .getAppVersion()
      .then(setVersion)
      .catch(() => {})
  }, [])
  const isWindows = window.sparkAPI.platform === 'win32'
  const protectedLocation = isWindows ? detectProtectedLocation(settings.clientPath) : null

  // Worktrees only exist for repo-mode targets, so the Flush Worktrees
  // maintenance action is only shown when a client/server repo is configured.
  const hasRepos =
    !!settings.targets?.hybrasyl?.clientRepoPath ||
    (settings.instances ?? []).some((i) => i.serverRepoPath || i.xmlRepoPath)

  async function flushWorktrees() {
    setFlushConfirm(false)
    setFlushing(true)
    setFlushResult(null)
    try {
      setFlushResult(await window.sparkAPI.flushWorktrees())
    } catch (err) {
      setFlushResult({ ok: false, repos: 0, removed: 0, errors: [{ error: err.message }] })
    } finally {
      setFlushing(false)
    }
  }

  async function browseClient() {
    try {
      // Windows: the Dark Ages.exe. macOS/Linux: the DA assets folder (no .exe
      // to run there — the Hybrasyl client only needs the asset directory).
      const path = isWindows
        ? await window.sparkAPI.openExeDialog(settings.clientPath)
        : await window.sparkAPI.pickDirectory(
            'Select Dark Ages assets folder',
            settings.clientPath,
            'Choose the folder containing your Dark Ages assets (the install directory with its .dat files).'
          )
      if (path) onChange({ clientPath: path })
    } catch (err) {
      console.error('[settings] client path browse failed:', err)
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
    // No "in use" guard: users want to clean up registry entries without
    // first re-pointing every instance. Instances with a dangling
    // worldDirectoryId fail at launch time with a clear "World directory
    // not selected — pick one in settings" message (instance:start guard
    // in main/index.js), and the Config tab dropdown shows the gap so the
    // user can re-pick.
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
        borderLeft: PANEL_BORDER,
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
          borderBottom: PANEL_BORDER
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
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Theme */}
        <SettingsSection panel="theme" title="Theme" expanded={expanded} onToggle={handleAccordion}>
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
        </SettingsSection>

        {/* Legacy Client — path + memory-patch version target */}
        <SettingsSection
          panel="client"
          title="Legacy Client"
          expanded={expanded}
          onToggle={handleAccordion}
          detailsSx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              {isWindows ? 'Client Executable' : 'Client Path'}
            </Typography>
            <TextField
              fullWidth
              size="small"
              value={settings.clientPath}
              onChange={(e) => onChange({ clientPath: e.target.value })}
              placeholder={isWindows ? 'Path to Darkages.exe' : 'Path to Dark Ages assets folder'}
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
            {protectedLocation && (
              <Alert severity="warning" sx={{ mt: 1, fontSize: 12 }}>
                This client is inside {protectedLocation}. Windows may block it from launching
                (error 740). Move it to a normal folder like C:\DarkAges.
              </Alert>
            )}
          </Box>

          {/* Client Version — legacy-client memory-patch target; irrelevant on
                non-Windows, where the path points at an asset folder with no version. */}
          {isWindows && (
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
          )}
        </SettingsSection>

        {/* Server Profiles */}
        <SettingsSection
          panel="profiles"
          title="Server Profiles"
          expanded={expanded}
          onToggle={handleAccordion}
          action={
            <Tooltip title="Add profile">
              <IconButton
                size="small"
                component="div"
                onClick={(e) => {
                  e.stopPropagation()
                  openAddProfile()
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        >
          <List dense disablePadding>
            {settings.profiles.map((p) => (
              <ListItem
                key={p.id}
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: p.id === settings.activeProfile ? ACTIVE_ROW_BG : 'transparent'
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
        </SettingsSection>

        {/* World Directories */}
        <SettingsSection
          panel="worlds"
          title="World Directories"
          expanded={expanded}
          onToggle={handleAccordion}
          action={
            <Tooltip title="Add world directory">
              <IconButton
                size="small"
                component="div"
                onClick={(e) => {
                  e.stopPropagation()
                  openAddWorldDir()
                }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          }
        >
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
                      bgcolor: isActive ? ACTIVE_ROW_BG : 'transparent',
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
                            ? `Delete — ${inUseCount} instance${inUseCount === 1 ? '' : 's'} will need a new world directory picked`
                            : 'Delete'
                        }
                      >
                        <IconButton size="small" onClick={() => deleteWorldDir(wd.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                )
              })}
            </List>
          )}
        </SettingsSection>

        {/* Maintenance — only relevant when a repo-mode target can spawn worktrees */}
        {hasRepos && (
          <SettingsSection
            panel="maintenance"
            title="Maintenance"
            expanded={expanded}
            onToggle={handleAccordion}
          >
            <Button
              variant="outlined"
              size="small"
              color="warning"
              onClick={() => setFlushConfirm(true)}
              disabled={flushing}
              sx={{ width: '100%' }}
            >
              {flushing ? 'Flushing…' : 'Flush Worktrees'}
            </Button>
            <Typography
              variant="caption"
              sx={{ mt: 0.5, display: 'block', opacity: 0.6, fontSize: 11 }}
            >
              Clears Epona-managed git worktrees for configured repos. Use this if a launch fails
              with a &quot;worktree already exists&quot; error.
            </Typography>
            {flushResult && (
              <Alert
                severity={flushResult.ok ? 'success' : 'warning'}
                sx={{ mt: 1, fontSize: 12 }}
                onClose={() => setFlushResult(null)}
              >
                {flushResult.ok
                  ? `Flushed ${flushResult.removed} worktree${flushResult.removed === 1 ? '' : 's'} across ${flushResult.repos} repo${flushResult.repos === 1 ? '' : 's'}.`
                  : `Flushed ${flushResult.removed}, but ${flushResult.errors.length} could not be removed (they may be in use — stop running servers/clients and retry).`}
              </Alert>
            )}
          </SettingsSection>
        )}

        <SettingsSection panel="about" title="About" expanded={expanded} onToggle={handleAccordion}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Epona{version ? ` v${version}` : ''}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
            {/* color="inherit" + always-underline keeps links readable on every
                theme — the fantasy themes use a dark primary.main (MUI Link's
                default), which is nearly invisible on their dark paper. */}
            <Link
              href="https://www.hybrasyl.com"
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              color="inherit"
              underline="always"
            >
              hybrasyl.com
            </Link>
            <Link
              href="https://github.com/eriscorp/epona"
              target="_blank"
              rel="noopener noreferrer"
              variant="body2"
              color="inherit"
              underline="always"
            >
              GitHub
            </Link>
          </Box>
          <Box
            sx={{
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              fontSize: '0.72rem',
              lineHeight: 1.7,
              opacity: 0.85
            }}
          >
            {`NEW FROM ERISCO™

EPONA
THE ONE THAT GOES BEFORE THE GAME
A LAUNCHER OF UNREASONABLE AMBITION

FEATURES:
- Launches things
- Occasionally the right things
- A button labeled "Flush Worktrees"

INCLUDES:
- Five and a half themes
- Strong opinions about %LOCALAPPDATA%
- The confidence of a native Win32 memory patch

SIDE EFFECTS:
- Sudden urge to run a server
- Diminished patience for double-clicking .exe files

WARNING:
Not affiliated with any horse.`}
          </Box>
        </SettingsSection>
      </Box>

      {flushConfirm && (
        <Dialog open onClose={() => setFlushConfirm(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontSize: '1rem' }}>Flush worktrees?</DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              This force-removes all Epona-managed git worktrees for your configured repos,
              discarding any uncommitted changes inside them. Stop any running servers or clients
              first. Your main checkouts are not touched.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button size="small" onClick={() => setFlushConfirm(false)}>
              Cancel
            </Button>
            <Button size="small" variant="contained" color="warning" onClick={flushWorktrees}>
              Flush
            </Button>
          </DialogActions>
        </Dialog>
      )}

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
      const derivedName = basenameOfPath(p)
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
