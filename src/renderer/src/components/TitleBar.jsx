import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import RemoveIcon from '@mui/icons-material/Remove'
import CloseIcon from '@mui/icons-material/Close'

export default function TitleBar() {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 36,
        px: 1.5,
        bgcolor: 'background.paper',
        WebkitAppRegion: 'drag',
        flexShrink: 0
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary', letterSpacing: 1 }}>
        EPONA
      </Typography>
      <Box sx={{ WebkitAppRegion: 'no-drag', display: 'flex' }}>
        <IconButton size="small" onClick={() => window.sparkAPI.minimizeWindow()} sx={{ p: 0.5 }}>
          <RemoveIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => window.sparkAPI.closeWindow()} sx={{ p: 0.5 }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}
