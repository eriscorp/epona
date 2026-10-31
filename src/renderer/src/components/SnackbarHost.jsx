import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

// Bottom-center transient snackbar shared across panels. Honors an optional
// `snack.duration` (defaults to 4000ms). `snack` is null when nothing to show.
// An optional `snack.action`, `{ label, onClick }`, puts a button beside the
// close X: MUI's Alert drops its own X when it has an action, so the X is drawn
// here too.
export default function SnackbarHost({ snack, onClose }) {
  const action = snack?.action ? (
    <>
      <Button color="inherit" size="small" onClick={snack.action.onClick}>
        {snack.action.label}
      </Button>
      <IconButton color="inherit" size="small" aria-label="Close" onClick={onClose}>
        <CloseIcon fontSize="small" />
      </IconButton>
    </>
  ) : undefined
  return (
    <Snackbar
      open={!!snack}
      autoHideDuration={snack?.duration ?? 4000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert severity={snack?.severity} onClose={onClose} action={action} sx={{ width: '100%' }}>
        {snack?.message}
      </Alert>
    </Snackbar>
  )
}
