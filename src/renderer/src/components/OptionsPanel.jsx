import Box from '@mui/material/Box'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Typography from '@mui/material/Typography'

const OPTIONS = [
  { key: 'skipIntro', label: 'Skip Intro' },
  { key: 'multipleInstances', label: 'Multiple Instances' },
  { key: 'hideWalls', label: 'Hide Walls' }
]

export default function OptionsPanel({ settings, onChange }) {
  return (
    <Box>
      <Typography variant="caption" color="text.button" sx={{ mb: 0.5, display: 'block' }}>
        Options
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
        {OPTIONS.map(({ key, label }) => (
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
        ))}
      </Box>
    </Box>
  )
}
