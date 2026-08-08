import { useEffect, useState } from 'react'
import { Snackbar, Alert, Button, IconButton, Link } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'

// The update-available banner. Adapted from creidhne's UpdateSnackbar — see the
// header of src/main/updateCheck.js for why this is a lift rather than a design.
//
// Changed from creidhne: the bridge name (sparkAPI, not electronAPI), the
// storage key, the product name — and one behavioural divergence, below.
//
// THE DIVERGENCE: creidhne wires the Snackbar's own `onClose` straight to the
// dismiss handler. With no `autoHideDuration` that handler fires on clickaway
// and on Escape, so a stray click anywhere in the window writes the dismissal
// key and the banner never returns for that version. Here `clickaway` is
// ignored, so only the X and Escape dismiss. Worth carrying back to whichever
// implementation the template adopts.
//
// NOT SnackbarHost. That component is the shared transient snack — it auto-hides
// after 4s and carries no action. This one must persist until dismissed and must
// offer a link, and a version that did both would have to grow two modes for one
// caller. Kept separate on purpose; do not "unify" them.

// Dismissal is per-version, so declining 2.8.0 does not also decline 2.9.0.
const DISMISS_KEY = 'epona:updateDismissedVersion'

// Let the window settle before spending a network round trip. Nothing here is
// urgent, and the first seconds after launch belong to the splash handoff.
const CHECK_DELAY_MS = 3000

export default function UpdateSnackbar() {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const result = await window.sparkAPI.checkForUpdates()
        if (!result?.ok || !result.updateAvailable) return
        if (localStorage.getItem(DISMISS_KEY) === result.latestVersion) return
        setInfo(result)
      } catch {
        /* silent — a startup check must never disturb the user */
      }
    }, CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])

  const handleDismiss = (_event, reason) => {
    if (reason === 'clickaway') return
    if (info?.latestVersion) localStorage.setItem(DISMISS_KEY, info.latestVersion)
    setInfo(null)
  }

  if (!info) return null

  return (
    <Snackbar
      open
      onClose={handleDismiss}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <Alert
        severity="info"
        variant="filled"
        action={
          // BOTH controls live in `action`, and the close button is explicit.
          // MUI's Alert renders its own X only when `onClose` is set AND
          // `action` is absent — passing `action` REPLACES it. creidhne passes
          // both, so its banner has no X at all and can only be dismissed by
          // clicking elsewhere. Carry this back with the clickaway fix above.
          <>
            <Button
              color="inherit"
              size="small"
              component={Link}
              href={info.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              View release
            </Button>
            <IconButton
              size="small"
              color="inherit"
              aria-label="Dismiss update notification"
              onClick={handleDismiss}
            >
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </>
        }
      >
        Epona {info.latestVersion} is available (you have {info.currentVersion}).
      </Alert>
    </Snackbar>
  )
}
