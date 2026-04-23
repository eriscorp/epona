import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom'

export default function LogPane({ title = 'Console', lines, onClear, onClose }) {
  const scrollRef = useRef(null)
  const [pinnedToBottom, setPinnedToBottom] = useState(true)

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setPinnedToBottom(distanceFromBottom < 8)
  }

  useEffect(() => {
    if (!pinnedToBottom) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines, pinnedToBottom])

  function scrollToBottom() {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setPinnedToBottom(true)
  }

  return (
    <Box
      sx={{
        flex: '1 1 0',
        minWidth: 0,
        height: '100%',
        position: 'relative',
        borderLeft: '1px solid rgba(255,255,255,0.15)',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper'
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1,
          py: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.15)'
        }}
      >
        <Typography variant="caption" color="text.button" sx={{ pl: 0.5 }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.25 }}>
          <Tooltip title="Clear">
            <IconButton size="small" onClick={onClear}>
              <DeleteSweepIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close">
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box
        ref={scrollRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 11,
          lineHeight: 1.4,
          p: 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      >
        {lines.length === 0 && (
          <Typography variant="caption" sx={{ opacity: 0.5, fontStyle: 'italic' }}>
            (no output yet — launch the client to see logs here)
          </Typography>
        )}
        {lines.map((entry, i) => (
          <Box
            key={i}
            component="div"
            sx={{
              color: entry.stream === 'stderr' ? 'warning.main' : 'text.primary',
              opacity: entry.stream === 'exit' ? 0.7 : 1,
              fontStyle: entry.stream === 'exit' ? 'italic' : 'normal'
            }}
          >
            {entry.text}
          </Box>
        ))}
      </Box>

      {!pinnedToBottom && (
        <Tooltip title="Jump to latest">
          <IconButton
            size="small"
            onClick={scrollToBottom}
            sx={{
              position: 'absolute',
              right: 12,
              bottom: 12,
              bgcolor: 'background.paper',
              border: '1px solid rgba(255,255,255,0.2)'
            }}
          >
            <VerticalAlignBottomIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}
