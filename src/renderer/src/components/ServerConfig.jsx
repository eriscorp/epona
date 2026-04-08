import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

export default function ServerConfig({ hostname, port, disabled, onChange }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Server
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          label="Hostname"
          value={hostname}
          disabled={disabled}
          onChange={(e) => onChange({ serverHostname: e.target.value })}
        />
        <TextField
          label="Port"
          type="number"
          value={port}
          disabled={disabled}
          onChange={(e) => onChange({ serverPort: Number(e.target.value) })}
          sx={{ width: 100 }}
          inputProps={{ min: 1, max: 65535 }}
        />
      </Box>
    </Box>
  )
}
