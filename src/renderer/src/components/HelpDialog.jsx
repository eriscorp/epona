import { useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  IconButton,
  Tooltip
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import { installItems, installIntro } from '../installHints'

export default function HelpDialog({ open, onClose }) {
  const platform = window.sparkAPI.platform
  const items = installItems(platform)
  // Track which command was most recently copied so the inline copy button
  // can flash a check icon for a couple of seconds. Keyed by item.key.
  const [copied, setCopied] = useState(null)

  async function copy(item) {
    try {
      await navigator.clipboard.writeText(item.command)
      setCopied(item.key)
      // 1500ms is a typical "did I see it?" window; long enough to register,
      // short enough that the icon resets before the user clicks another.
      setTimeout(() => setCopied((prev) => (prev === item.key ? null : prev)), 1500)
    } catch (err) {
      console.error('[help] clipboard write failed:', err)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem' }}>Recommended installs</DialogTitle>
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}
      >
        <Typography variant="caption" color="text.secondary">
          {installIntro(platform)}
        </Typography>
        {items.map((item) => (
          <Box key={item.key}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {item.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {item.why}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)'
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily: 'monospace',
                  fontSize: 12,
                  flex: 1,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}
              >
                {item.command}
              </Typography>
              <Tooltip title={copied === item.key ? 'Copied' : 'Copy to clipboard'}>
                <IconButton size="small" onClick={() => copy(item)}>
                  {copied === item.key ? (
                    <CheckIcon fontSize="small" color="success" />
                  ) : (
                    <ContentCopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}
