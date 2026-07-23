import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'

const OPTIONS = [
  { key: 'skipIntro', label: 'Skip Intro' },
  { key: 'multipleInstances', label: 'Multiple Instances' },
  { key: 'hideWalls', label: 'Hide Walls' },
  {
    key: 'groundItemHints',
    label: 'Ground Item Hints',
    // Hook-based, so it only appears for a client build whose hook sites have
    // actually been mapped (7.41 today).
    patch: 'groundItemHints',
    tip: 'Hold either Alt key to replay visible ground items as translucent hints.'
  }
]

export default function OptionsPanel({ settings, onChange, availablePatches = [] }) {
  const visible = OPTIONS.filter((o) => !o.patch || availablePatches.includes(o.patch))
  return (
    <Box>
      <Typography variant="caption" color="text.button" sx={{ mb: 0.5, display: 'block' }}>
        Options
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
        {visible.map(({ key, label, tip }) => {
          const control = (
            <FormControlLabel
              key={key}
              control={
                <Checkbox
                  size="small"
                  checked={!!settings[key]}
                  onChange={(e) => onChange({ [key]: e.target.checked })}
                />
              }
              label={<Typography variant="body2">{label}</Typography>}
              sx={{ width: '50%', m: 0 }}
            />
          )
          return tip ? (
            <Tooltip key={key} title={tip}>
              {control}
            </Tooltip>
          ) : (
            control
          )
        })}
      </Box>
    </Box>
  )
}
