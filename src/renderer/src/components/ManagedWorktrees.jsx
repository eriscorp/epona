import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
// icons v9 dropped the deprecated base names — use the Outlined variant.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'

// The Epona-managed git worktrees currently on disk, one row per branch, with a
// per-row Remove. Sits above Flush Worktrees in Settings → Maintenance: Flush is
// the blunt "unstick me" hammer that discards everything, this is the scalpel.
//
// Mounted only while the Maintenance section is expanded, so the listing (which
// shells out to git per worktree) runs when the user asks to see it.
export default function ManagedWorktrees({ onResult }) {
  const [rows, setRows] = useState(null) // null = still loading
  const [pendingRemove, setPendingRemove] = useState(null)
  const [busyPath, setBusyPath] = useState(null)

  const load = useCallback(async () => {
    try {
      setRows(await window.sparkAPI.listManagedWorktrees())
    } catch (err) {
      setRows([])
      onResult?.({ severity: 'error', message: `Couldn't list worktrees: ${err.message}` })
    }
  }, [onResult])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(row, force) {
    setPendingRemove(null)
    setBusyPath(row.path)
    const result = await window.sparkAPI.removeWorktree(row.repo, row.branch, force)
    setBusyPath(null)
    if (result?.ok) {
      onResult?.({ severity: 'success', message: `Removed worktree for "${row.branch}"` })
    } else if (result?.reason === 'in-use') {
      onResult?.({
        severity: 'warning',
        message: `"${row.branch}" is still in use — stop the launch using it first.`
      })
    } else {
      onResult?.({
        severity: 'error',
        message: `Couldn't remove "${row.branch}"${result?.error ? `: ${result.error}` : ''}`
      })
    }
    void load()
  }

  // A row asks for confirmation only when removing would lose something.
  function requestRemove(row) {
    if (row.dirty) setPendingRemove(row)
    else void remove(row, false)
  }

  if (rows === null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <CircularProgress size={14} />
        <Typography variant="caption">Listing worktrees…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          Managed worktrees
        </Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={load}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {rows.length === 0 ? (
        <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, fontSize: 11 }}>
          None on disk.
        </Typography>
      ) : (
        rows.map((row) => (
          <Box
            key={row.path}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, minWidth: 0 }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontSize: 12 }}>
                {row.branch ?? '(detached)'}
              </Typography>
              <Tooltip title={row.path}>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ display: 'block', opacity: 0.6, fontSize: 10 }}
                >
                  {row.path}
                </Typography>
              </Tooltip>
            </Box>
            {row.dirty && <Chip size="small" label="dirty" color="warning" sx={{ height: 18 }} />}
            {row.refcount > 0 && (
              <Chip size="small" label="in use" color="info" sx={{ height: 18 }} />
            )}
            <Tooltip title={row.refcount > 0 ? 'In use by a running launch' : 'Remove worktree'}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => requestRemove(row)}
                  disabled={row.refcount > 0 || busyPath === row.path}
                >
                  {busyPath === row.path ? (
                    <CircularProgress size={14} />
                  ) : (
                    <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                  )}
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ))
      )}

      {pendingRemove && (
        <Dialog open onClose={() => setPendingRemove(null)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ fontSize: '1rem' }}>
            Remove &quot;{pendingRemove.branch}&quot; with uncommitted changes?
          </DialogTitle>
          <DialogContent>
            <Typography variant="body2">
              This worktree has uncommitted changes. Removing it discards them. Your main checkout
              is not touched.
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button size="small" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              color="warning"
              onClick={() => remove(pendingRemove, true)}
            >
              Remove
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  )
}
