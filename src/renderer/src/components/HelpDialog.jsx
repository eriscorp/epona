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

// One row per recommended dependency. Each command is a winget install
// invocation — winget ships with Windows 10 1809+ and Windows 11, no admin
// required beyond a UAC consent prompt. After installing, the user needs to
// restart Epona (and any open terminals) so the new PATH is picked up.
const ITEMS = [
  {
    key: 'memurai',
    name: 'Memurai Developer',
    why: 'Native Windows Redis-compatible server. Use this instead of WSL Redis to avoid the WSL2 localhost-forwarding stalls Hybrasyl server hits on launch.',
    command: 'winget install Memurai.MemuraiDeveloper'
  },
  {
    key: 'git',
    name: 'Git',
    why: 'Required for repo-mode launches with branch switching. Without git, repo-mode still works but Epona launches directly from the picked folder with no branch picker.',
    command: 'winget install --id Git.Git -e --source winget'
  },
  {
    key: 'dotnet-sdk',
    name: '.NET 10 SDK',
    why: 'Required for repo-mode launches — `dotnet run` compiles the project before running. The runtime alone is not enough for source launches.',
    command: 'winget install --id Microsoft.DotNet.SDK.10 -e'
  },
  {
    key: 'dotnet-runtime',
    name: '.NET 10 Runtime',
    why: 'Required to run a prebuilt Hybrasyl client or server (.dll). Self-contained .exe launches do not need this. Included with the SDK above — install just the runtime if you only run prebuilt artifacts.',
    command: 'winget install --id Microsoft.DotNet.Runtime.10 -e'
  }
]

export default function HelpDialog({ open, onClose }) {
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
          Copy a command and paste into PowerShell. winget ships with Windows 10 1809+ and Windows
          11. Restart Epona after installing so the new PATH is picked up.
        </Typography>
        {ITEMS.map((item) => (
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
