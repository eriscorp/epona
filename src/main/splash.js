import { BrowserWindow } from 'electron'
import { join } from 'path'

// How long to wait for 'ready-to-show' before showing the splash anyway.
const FALLBACK_SHOW_MS = 500
// Self-destruct deadline. Longer than the 15s reveal backstop in index.js, so
// this only fires when that path failed too.
const SELF_DESTRUCT_MS = 20000

// A small branded window shown the instant the app boots, so the user sees
// something immediately while the main window's renderer bundle evaluates,
// React mounts, and loadSettings() settles. Torn down by revealMainWindow()
// once the renderer signals it has hydrated its settings ('app:ready'), or by
// the main window's 'closed' handler if the main window dies first.
export function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 360,
    height: 300,
    frame: false,
    resizable: false,
    movable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    // Solid background (no transparency) so it renders reliably across GPUs.
    backgroundColor: '#0c1524',
    // The splash has no IPC needs; keep it isolated with no preload.
    webPreferences: { sandbox: true }
  })

  // Loaded from resources/ via the same '../../resources/...' convention the
  // main window's icon already uses (works in dev and packaged/asar builds).
  splash.loadFile(join(__dirname, '../../resources/splash.html')).catch((err) => {
    console.error('Failed to load splash:', err)
  })

  // 'ready-to-show' can fail to fire (it's unreliable for frameless/transparent
  // windows on Windows), which would leave the splash silently invisible for the
  // whole boot. Back it with a timer and make show() idempotent so whichever
  // path wins is harmless.
  const showOnce = () => {
    if (!splash.isDestroyed() && !splash.isVisible()) splash.show()
  }
  splash.once('ready-to-show', showOnce)
  const showTimer = setTimeout(showOnce, FALLBACK_SHOW_MS)

  // Last-resort self-destruct: an alwaysOnTop + skipTaskbar window that outlives
  // a failed boot can't be focused, closed, or found in the taskbar.
  const destructTimer = setTimeout(() => {
    if (!splash.isDestroyed()) splash.destroy()
  }, SELF_DESTRUCT_MS)

  splash.on('closed', () => {
    clearTimeout(showTimer)
    clearTimeout(destructTimer)
  })

  return splash
}
