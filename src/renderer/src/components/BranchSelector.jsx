import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import RefreshIcon from '@mui/icons-material/Refresh'
import { CURRENT_CHECKOUT_VALUE } from '../pickerConstants'

// Branch <Select> + refresh IconButton, shared by the server-repo, XML-repo,
// and client-repo pickers. `allowCurrentCheckout` toggles between the sentinel
// "(current checkout)" option (server/client) and the empty "(select a
// branch…)" placeholder (XML). `onChange` receives the already-mapped branch
// value (null for the sentinel).
export default function BranchSelector({
  label,
  value,
  branches,
  disabled,
  loading,
  noGit,
  error,
  onChange,
  onOpen,
  onRefresh,
  allowCurrentCheckout,
  noGitText
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
      <FormControl size="small" disabled={disabled} sx={{ flex: 1 }}>
        <InputLabel shrink>{label}</InputLabel>
        <Select
          label={label}
          notched
          value={allowCurrentCheckout ? (value ?? CURRENT_CHECKOUT_VALUE) : (value ?? '')}
          onChange={(e) =>
            onChange(
              allowCurrentCheckout && e.target.value === CURRENT_CHECKOUT_VALUE
                ? null
                : e.target.value
            )
          }
          onOpen={onOpen}
          displayEmpty={!allowCurrentCheckout}
        >
          {allowCurrentCheckout && (
            <MenuItem value={CURRENT_CHECKOUT_VALUE}>(current checkout)</MenuItem>
          )}
          {!allowCurrentCheckout && value === '' && (
            <MenuItem value="" disabled>
              (select a branch…)
            </MenuItem>
          )}
          {branches.map((b) => (
            <MenuItem key={b.name} value={b.name}>
              {b.name}
              {b.current ? ' (current)' : ''}
              {b.remote ? ' (remote)' : ''}
              {b.missing ? (b.loading ? ' (loading…)' : ' (missing)') : ''}
            </MenuItem>
          ))}
        </Select>
        {noGit ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.5, fontStyle: 'italic' }}
          >
            {noGitText}
          </Typography>
        ) : (
          error && (
            <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
              Couldn&apos;t list branches: {error}
            </Typography>
          )
        )}
      </FormControl>
      <Tooltip title={noGit ? 'Git not available' : 'Refresh branch list'}>
        <span>
          <IconButton
            size="small"
            onClick={onRefresh}
            disabled={disabled || loading}
            sx={{ mt: 0.5 }}
          >
            {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}
