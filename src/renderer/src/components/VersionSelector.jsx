import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'

export default function VersionSelector({ versions, value, onChange }) {
  return (
    <Box>
      <FormControl fullWidth size="small">
        <InputLabel>Client Version</InputLabel>
        <Select value={value} label="Client Version" onChange={(e) => onChange(e.target.value)}>
          <MenuItem value="auto">Auto-detect</MenuItem>
          {versions.map((v) => (
            <MenuItem key={v.versionCode} value={v.versionCode}>
              {v.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  )
}
