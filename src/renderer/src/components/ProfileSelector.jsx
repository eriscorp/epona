import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'

export default function ProfileSelector({ profiles, activeProfile, onChange }) {
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
          {profile.redirect ? `${profile.hostname}:${profile.port}` : 'No redirect (official servers)'}
        </Typography>
      )}
    </Box>
  )
}
