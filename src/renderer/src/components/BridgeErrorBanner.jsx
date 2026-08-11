import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// Shown when the renderer could not reach the main process at startup.
//
// Deliberately built from nothing but MUI primitives and literal text. Every
// other route Epona has for reporting a problem — the Report Issue dialog,
// "Reveal logs", even reading the app version — is an `ipcRenderer.invoke`, so
// in exactly the state this banner exists to describe, all of them are dead.
// A user in that state sees an app where checkboxes toggle and text fields
// accept typing, but no button does anything: renderer-local state still works,
// and nothing that crosses IPC does. Without this, there is nothing on screen
// that says so.
//
// The logs path is spelled out rather than made a button for the same reason:
// opening it would be an invoke.
const LOGS_PATH = '%LOCALAPPDATA%\\Erisco\\Epona\\logs'

export default function BridgeErrorBanner({ error }) {
  if (!error) return null
  return (
    <Box
      role="alert"
      sx={{
        px: 1.5,
        py: 1,
        bgcolor: 'error.dark',
        color: 'common.white',
        flexShrink: 0
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Epona cannot reach its background process.
      </Typography>
      <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
        Buttons will not respond and your settings are not being saved. The window is showing
        defaults, not your saved configuration. Please report this, and include the newest file in{' '}
        {LOGS_PATH}
      </Typography>
      <Typography
        variant="caption"
        component="p"
        sx={{ mt: 0.5, opacity: 0.85, wordBreak: 'break-word' }}
      >
        {error}
      </Typography>
    </Box>
  )
}
