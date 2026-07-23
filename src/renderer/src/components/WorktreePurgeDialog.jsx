import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'

// Offered when a branch switch leaves a managed worktree behind. Keep is the
// default: removing is the destructive direction, and a worktree with
// uncommitted work has to say so loudly before Remove discards it.
export default function WorktreePurgeDialog({ worktree, busy, onKeep, onRemove }) {
  if (!worktree) return null
  return (
    <Dialog open onClose={onKeep} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>
        Remove the worktree for &quot;{worktree.branch}&quot;?
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          You switched away from this branch. Its Epona-managed worktree is still on disk:
        </Typography>
        <Typography
          variant="caption"
          sx={{ display: 'block', fontFamily: 'monospace', wordBreak: 'break-all', mb: 1 }}
        >
          {worktree.path}
        </Typography>
        {worktree.dirty ? (
          <Alert severity="warning" variant="outlined">
            This worktree has uncommitted changes. Removing it discards them.
          </Alert>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Keeping it costs disk space but makes the next launch on this branch faster.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onKeep} disabled={busy}>
          Keep
        </Button>
        <Button
          size="small"
          variant="contained"
          color={worktree.dirty ? 'warning' : 'primary'}
          onClick={onRemove}
          disabled={busy}
        >
          Remove
        </Button>
      </DialogActions>
    </Dialog>
  )
}
