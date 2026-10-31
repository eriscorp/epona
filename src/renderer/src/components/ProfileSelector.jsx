import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'

// Where a launch goes with this profile. `redirect` is the legacy client's
// memory patch, and it decides the legacy caption only. The Hybrasyl client is
// sent to the profile's host whenever it has one (DA_HOST in hybrasylTarget.js),
// so "No redirect (official servers)" was wrong for it (HTOO-659).
export function profileCaption(profile, targetKind) {
  if (targetKind === 'hybrasyl') {
    return profile.hostname ? `${profile.hostname}:${profile.port}` : "The client's own server"
  }
  return profile.redirect ? `${profile.hostname}:${profile.port}` : 'No redirect (official servers)'
}

export default function ProfileSelector({
  profiles,
  activeProfile,
  onChange,
  targetKind = 'legacy'
}) {
  const profile = profiles.find((p) => p.id === activeProfile) || profiles[0]

  return (
    <Box>
      <FormControl fullWidth size="small">
        <InputLabel>Server Profile</InputLabel>
        <Select
          value={activeProfile}
          label="Server Profile"
          onChange={(e) => onChange(e.target.value)}
        >
          {profiles.map((p) => (
            <MenuItem key={p.id} value={p.id}>
              {p.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {profile && (
        <Typography variant="caption" color="text.button" sx={{ mt: 0.5, display: 'block' }}>
          {profileCaption(profile, targetKind)}
        </Typography>
      )}
    </Box>
  )
}
