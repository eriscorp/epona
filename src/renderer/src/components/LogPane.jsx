import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import CloseIcon from '@mui/icons-material/Close'
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'
import SaveAltIcon from '@mui/icons-material/SaveAlt'
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom'
import { PANEL_BORDER, PANE_W } from '../uiConstants.js'
import { useRuntime } from '../store/runtimeStore.js'
import { formatLogLines } from '../../../shared/logFormat.js'

// Stable empty reference so the selector doesn't return a fresh [] every store
// update (which would defeat zustand's identity check and re-render on churn).
const EMPTY = []

// `source` is 'hybrasyl' or a server-instance id. LogPane subscribes to just
// that slice of the runtime store, so log streaming re-renders only this pane
// — not App and its panels. `slug` is the save-dialog filename stem.
export default function LogPane({ title = 'Console', source, slug, onClose }) {
  const lines = useRuntime((s) =>
    source === 'hybrasyl' ? s.hybrasylLog : (s.instanceLogs[source] ?? EMPTY)
  )
  const clearHybrasyl = useRuntime((s) => s.clearHybrasyl)
  const clearInstance = useRuntime((s) => s.clearInstance)
  const onClear = () => (source === 'hybrasyl' ? clearHybrasyl() : clearInstance(source))

  // Format the buffered lines and ship to main for a save dialog. Stream tags
  // (stderr/exit) are preserved so the file reads meaningfully on its own.
  async function onSave() {
    if (lines.length === 0) return
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    const result = await window.sparkAPI.saveLog(formatLogLines(lines), `${slug}-${ts}.log`)
    if (result && !result.ok && !result.canceled) {
      console.error('[log] save failed:', result.error)
    }
  }

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
        // Rigid, like SettingsPane — App.jsx's resize request assumes each open
        // pane is exactly PANE_W. As `1 1 0` this pane silently absorbed any
        // width the window came back short by, which hid the mismatch here and
        // pushed it onto the main panel instead. The main panel is now the one
        // elastic column; the panes hold their width.
        flex: `0 0 ${PANE_W}px`,
        minWidth: 0,
        height: '100%',
        position: 'relative',
        borderLeft: PANEL_BORDER,
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
          borderBottom: PANEL_BORDER
        }}
      >
        <Typography variant="caption" color="text.button" sx={{ pl: 0.5 }}>
          {title}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.25 }}>
          {onSave && (
            <Tooltip title="Save log to file…">
              <span>
                <IconButton size="small" onClick={onSave} disabled={lines.length === 0}>
                  <SaveAltIcon fontSize="inherit" />
                </IconButton>
              </span>
            </Tooltip>
          )}
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
          wordBreak: 'break-word',
          // Re-enable text selection here — base.css sets `user-select: none`
          // globally for a native-app feel, but console output must be
          // copy/paste-able. Scoped to the log body so the chrome stays inert.
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text'
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
