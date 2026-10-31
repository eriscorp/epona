// The snackbar for a Reveal button whose folder did not open (HTOO-658). Main
// returns `{ ok: false, path, error }` from shell.openPath. The notice names the
// folder, so the user can open it by hand. null when the folder opened, or when
// the bridge gave no answer.
export function revealFailure(result) {
  if (!result || result.ok !== false) return null
  return {
    severity: 'error',
    message: `Could not open the folder ${result.path}: ${result.error}`,
    duration: 10000
  }
}
