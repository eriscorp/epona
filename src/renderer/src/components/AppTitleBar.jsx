import Box from '@mui/material/Box'
import TitleBar from './TitleBar'
import { useSettings } from '../store/settingsStore.js'
import { bridge } from '../diagnosticsBridge.js'
import { appIdentity } from '../../../shared/appIdentity.js'
import eponaIcon from '../assets/epona.webp'
import { EPONA_WORDMARK_SIZE } from '../themes/eponaThemes'

/**
 * Epona's title bar: the house `TitleBar` (title-bar v1, HTOO-572), wired to
 * Epona's settings, icon and window calls. The house module stays as the
 * template has it; change this file, not that one.
 *
 * The window has a fixed size (`maximizable: false`, and main locks min == max
 * on each resize), so the controls have no `maximize`, and the bar draws two
 * window buttons. Epona's other controls are on the NavToolbar below it.
 *
 * The house TitleBar draws its wordmark at 1.5rem, pinned with `&&`. Epona's
 * window is 480 px wide, so the wordmark is EPONA_WORDMARK_SIZE (Sabrael,
 * 2026-10-24). The Box around the bar sets it with a selector of higher
 * specificity than `&&`, so the house file stays as the template has it. The
 * Box is `display: contents`: it draws no box, and the bar's layout is the same.
 */
export default function AppTitleBar() {
  const theme = useSettings((s) => s.settings?.theme)
  return (
    <Box
      sx={{
        display: 'contents',
        '& [data-testid="title-bar"] .MuiTypography-h6': { fontSize: EPONA_WORDMARK_SIZE }
      }}
    >
      <TitleBar
        name={appIdentity.productName}
        icon={eponaIcon}
        theme={theme}
        platform={bridge().platform}
        controls={{
          minimize: () => bridge().minimizeWindow(),
          close: () => bridge().closeWindow()
        }}
      />
    </Box>
  )
}
