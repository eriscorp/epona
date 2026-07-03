import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'

// Bottom-center transient snackbar shared across panels. Honors an optional
// `snack.duration` (defaults to 4000ms). `snack` is null when nothing to show.
export default function SnackbarHost({ snack, onClose }) {
  return (
    <Snackbar
      open={!!snack}
      autoHideDuration={snack?.duration ?? 4000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity={snack?.severity} onClose={onClose} sx={{ width: '100%' }}>
        {snack?.message}
      </Alert>
    </Snackbar>
  )
}
