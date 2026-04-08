import Box from '@mui/material/Box'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

export default function ClientPathPicker({ clientPath, detectedVersion, onPathChange }) {
  async function browse() {
    const path = await window.sparkAPI.openExeDialog()
    if (path) onPathChange(path)
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        Client Path
      </Typography>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          value={clientPath}
          onChange={(e) => onPathChange(e.target.value)}
          placeholder="C:\Program Files\Dark Ages\Darkages.exe"
          inputProps={{ style: { fontSize: 12 } }}
        />
        <Button variant="outlined" onClick={browse} sx={{ flexShrink: 0 }}>
          Browse
        </Button>
      </Box>
      {detectedVersion && (
        <Typography variant="caption" color="primary" sx={{ mt: 0.5, display: 'block' }}>
          Detected: {detectedVersion}
        </Typography>
      )}
    </Box>
  )
}
