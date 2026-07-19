import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Link,
  Box,
  Divider
} from '@mui/material'
import { bridge } from '../diagnosticsBridge.js'

/** The obligatory ERISCO™ parody-ad About dialog (house style — see mabon /
 *  creidhne / oghma). Version comes from main via `getAppVersion`. */
function AboutDialog({ open, onClose }) {
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (open) void bridge()?.getAppVersion().then(setVersion)
  }, [open])

  const sections = [
    [
      'FEATURES',
      ['Launches things', 'Occasionally the right things', 'A button labeled "Flush Worktrees"']
    ],
    [
      'INCLUDES',
      [
        'Five and a half themes',
        'Strong opinions about %LOCALAPPDATA%',
        'The confidence of a native Win32 memory patch'
      ]
    ],
    [
      'SIDE EFFECTS',
      ['Sudden urge to run a server', 'Diminished patience for double-clicking .exe files']
    ]
  ]

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' }}>
        About Epona
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" gutterBottom sx={{ color: 'text.secondary' }}>
          Version {version}
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          {/* color="inherit" + always-underline keeps links readable on the dark
              fantasy themes, whose primary.main is near-invisible on dark paper. */}
          <Link
            href="https://www.hybrasyl.com"
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            color="inherit"
            underline="always"
          >
            hybrasyl.com
          </Link>
          <Link
            href="https://github.com/eriscorp/epona"
            target="_blank"
            rel="noopener noreferrer"
            variant="body2"
            color="inherit"
            underline="always"
          >
            GitHub
          </Link>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Box
          sx={{
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            fontSize: '0.8rem',
            lineHeight: 1.7
          }}
        >
          <Typography
            variant="body2"
            sx={{ fontFamily: 'inherit', fontWeight: 'bold', letterSpacing: 1 }}
          >
            NEW FROM ERISCO™
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontFamily: 'inherit', fontWeight: 'bold', fontSize: '1.1rem', mt: 1 }}
          >
            EPONA
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'inherit', fontStyle: 'italic', mb: 1 }}>
            THE ONE THAT GOES BEFORE THE GAME
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: 'inherit', mb: 2 }}>
            A LAUNCHER OF UNREASONABLE AMBITION
          </Typography>

          {sections.map(([heading, items]) => (
            <Box key={heading} sx={{ mb: 1.5 }}>
              <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
                {heading}:
              </Typography>
              {items.map((item) => (
                <Typography key={item} variant="body2" sx={{ fontFamily: 'inherit', pl: 1 }}>
                  - {item}
                </Typography>
              ))}
            </Box>
          ))}

          <Box sx={{ mt: 2, borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}>
            <Typography variant="body2" sx={{ fontFamily: 'inherit', fontWeight: 'bold' }}>
              WARNING:
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: 'inherit' }}>
              Not affiliated with any horse.
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default AboutDialog
