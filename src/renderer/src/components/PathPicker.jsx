import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import { PICKER_SX } from '../pickerConstants'

// A caption label row + resolved-path text + Browse… button, shared by the
// server and client panels. `chip` renders an optional status chip beside the
// label; `extraAction` appends an extra control after the Browse button (e.g.
// the "open log folder" icon).
export default function PathPicker({
  label,
  value,
  onPick,
  disabled,
  placeholder,
  chip,
  extraAction
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.button">
          {label}
        </Typography>
        {chip && <Chip size="small" {...chip} variant="outlined" />}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="body2" sx={{ ...PICKER_SX, opacity: value ? 1 : 0.5 }}>
          {value || placeholder}
        </Typography>
        {onPick && (
          <Button size="small" variant="outlined" disabled={disabled} onClick={onPick}>
            Browse…
          </Button>
        )}
        {extraAction}
      </Box>
    </Box>
  )
}
