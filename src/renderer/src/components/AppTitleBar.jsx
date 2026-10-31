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
 * The house TitleBar draws its wordmark at 1.5rem by default. Epona's window is
 * 480 px wide, so it passes EPONA_WORDMARK_SIZE, 1.15rem (Sabrael, 2026-10-24).
 */
export default function AppTitleBar() {
  const theme = useSettings((s) => s.settings?.theme)
  return (
    <TitleBar
      name={appIdentity.productName}
      icon={eponaIcon}
      theme={theme}
      platform={bridge().platform}
      controls={{
        minimize: () => bridge().minimizeWindow(),
        close: () => bridge().closeWindow()
      }}
      wordmarkSize={EPONA_WORDMARK_SIZE}
    />
  )
}
