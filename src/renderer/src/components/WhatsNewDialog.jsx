import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Chip,
  Box,
  Divider
} from '@mui/material'
import { parseInline } from '../../../shared/changelog.js'
import { bridge } from '../diagnosticsBridge.js'

// Reads the CHANGELOG.md packaged with this build (main resolves it from the app
// root) and renders it. The whole history is here and scrollable; the section
// matching the running version is chipped and scrolled into view on open, so a
// user who just updated lands on their own release rather than the top of a file
// that may have moved ahead of them.
//
// The renderer is deliberately hand-rolled rather than react-markdown: the input
// is one file we author ourselves in a known shape, and a markdown dependency in
// the renderer is 100s of kB bundled for it (see R-003 in the house docs).

/** Render one bullet's inline runs — `**bold**` and `` `code` `` — as elements. */
function InlineText({ text }) {
  return parseInline(text).map((run, i) => {
    if (run.type === 'strong') return <strong key={i}>{run.value}</strong>
    if (run.type === 'code') {
      return (
        <Box
          key={i}
          component="code"
          sx={{
            fontFamily: 'monospace',
            fontSize: '0.85em',
            px: 0.5,
            py: 0.1,
            borderRadius: 0.5,
            bgcolor: 'action.hover'
          }}
        >
          {run.value}
        </Box>
      )
    }
    return <span key={i}>{run.value}</span>
  })
}

function ReleaseSection({ section, isCurrent, anchorRef }) {
  return (
    <Box ref={anchorRef} sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', letterSpacing: 1 }}>
          {section.version}
        </Typography>
        {section.date && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {section.date}
          </Typography>
        )}
        {isCurrent && <Chip label="You're running this" size="small" color="primary" />}
      </Box>

      {section.groups.map((group) => (
        <Box key={group.heading} sx={{ mb: 1.5 }}>
          {group.heading && (
            <Typography
              variant="overline"
              sx={{ color: 'text.secondary', letterSpacing: 1.5, display: 'block' }}
            >
              {group.heading}
            </Typography>
          )}
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {group.items.map((item, i) => (
              <Typography key={i} component="li" variant="body2" sx={{ mb: 0.75 }}>
                <InlineText text={item} />
              </Typography>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

function WhatsNewDialog({ open, onClose }) {
  const [sections, setSections] = useState(null) // null = still loading
  const [version, setVersion] = useState('')
  const currentRef = useRef(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const api = bridge()
    Promise.all([api?.readChangelog() ?? [], api?.getAppVersion() ?? ''])
      .then(([entries, appVersion]) => {
        if (cancelled) return
        setSections(Array.isArray(entries) ? entries : [])
        setVersion(appVersion ?? '')
      })
      .catch(() => {
        if (!cancelled) setSections([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Scroll the running version into view once its section has rendered. Skipped
  // when it is already the first section (the common case — nothing to scroll).
  useEffect(() => {
    if (!sections || !currentRef.current) return
    if (sections[0]?.version === version) return
    currentRef.current.scrollIntoView({ block: 'start' })
  }, [sections, version])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold', letterSpacing: 2, textTransform: 'uppercase' }}>
        What&apos;s New
      </DialogTitle>
      <DialogContent dividers sx={{ maxHeight: '60vh' }}>
        {sections === null && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Loading…
          </Typography>
        )}

        {sections?.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            No release notes shipped with this build. The full history is on{' '}
            <Box component="span" sx={{ fontFamily: 'monospace' }}>
              github.com/eriscorp/epona/releases
            </Box>
            .
          </Typography>
        )}

        {sections?.map((section, i) => (
          <Box key={section.version}>
            {i > 0 && <Divider sx={{ mb: 2.5 }} />}
            <ReleaseSection
              section={section}
              isCurrent={section.version === version}
              anchorRef={section.version === version ? currentRef : undefined}
            />
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="contained" size="small">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default WhatsNewDialog
