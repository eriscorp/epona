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
// opening it would be an invoke. It is the path for this OS: the banner gave
// the Windows path on every OS, when it is the user's only route to the logs
// (HTOO-648). The platform comes from the preload's `platform`, a plain
// property that needs no IPC, or from `navigator.platform` when there is no
// bridge at all.
export function logsPathFor(platform) {
  if (platform === 'win32') return '%LOCALAPPDATA%\\Erisco\\Epona\\logs'
  if (platform === 'darwin') return '~/Library/Application Support/Erisco/Epona/logs'
  return '~/.config/Erisco/Epona/logs'
}

function currentPlatform() {
  const fromBridge = globalThis.window?.sparkAPI?.platform
  if (typeof fromBridge === 'string') return fromBridge
  const nav = globalThis.navigator?.platform ?? ''
  if (/^Win/i.test(nav)) return 'win32'
  if (/^Mac/i.test(nav)) return 'darwin'
  return 'linux'
}

export default function BridgeErrorBanner({ error }) {
  if (!error) return null
  return (
    <Box
      role="alert"
      sx={{
        px: 1.5,
        py: 1,
        // A `.dark` status fill picks its own label (the house rule, HTOO-572):
        // contrastText is picked against main and can be dark on a dark `.dark`.
        // palette.test.js holds getContrastText(error.dark) to 4.5:1.
        bgcolor: 'error.dark',
        color: (theme) => theme.palette.getContrastText(theme.palette.error.dark),
        flexShrink: 0
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        Epona cannot reach its background process.
      </Typography>
      <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
        Buttons will not respond and your settings are not being saved. The window is showing
        defaults, not your saved configuration. Please report this, and include the newest file in{' '}
        {logsPathFor(currentPlatform())}
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
