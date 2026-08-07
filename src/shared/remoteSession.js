// Remote-session detection and the mitigations that hang off it.
//
// A Remote Desktop session has no GPU: Windows attaches the Microsoft Remote
// Display Adapter, Chromium falls back to software rasterisation, and every
// repaint is then captured and encoded by RDP itself. Epona is frameless, so
// dragging goes through Chromium's app-region hit testing rather than a native
// title-bar move — the more expensive path under exactly those conditions.
//
// This is detected rather than exposed as a setting, deliberately.
// app.disableHardwareAcceleration() has to run BEFORE the 'ready' event, and
// settings load through fs.promises with no synchronous path — a persisted
// toggle would need a sync read at module load that races
// migrateSettingsFromRoaming. Reading one environment variable sidesteps all of
// it, and the app adapting on its own beats asking the user to find a checkbox.
//
// Pure so it can live in src/shared and be unit-tested: callers pass the
// platform and environment in rather than this module reaching for globals.

// Windows sets SESSIONNAME to 'Console' for a local session and 'RDP-Tcp#NN'
// for a remote one. Unset happens in some service and scheduled-task launch
// contexts; treat that as local, which is the safe default — a false positive
// would needlessly disable the GPU for someone sitting at the machine.
//
// This does not detect Parsec, Sunshine, VNC or other non-RDP remote tools.
// GetSystemMetrics(SM_REMOTESESSION) is the authoritative check but misses those
// same tools, so a native call buys accuracy that is mostly theoretical while
// adding a .node load to the pre-ready boot path. Not worth it.
export function isRemoteSession({ platform, sessionName } = {}) {
  if (platform !== 'win32') return false
  if (typeof sessionName !== 'string' || sessionName === '') return false
  return sessionName.toLowerCase() !== 'console'
}

// Read the real environment. Split from the predicate so tests can drive the
// predicate directly without mutating process.env.
export function detectRemoteSession(proc = process) {
  return isRemoteSession({
    platform: proc.platform,
    sessionName: proc.env?.SESSIONNAME
  })
}

// backdrop-filter is the single most expensive thing in the UI once compositing
// is on the CPU. Four of the six themes put `backdropFilter: blur(2px)` on
// MuiPaper.root, and MuiPaper backs Card, Dialog, Accordion and Menu — so most
// surfaces force Chromium to read back everything behind them and blur it, on
// every repaint, including every frame of a window drag. With a GPU that is
// nearly free; under software compositing it is not.
//
// Injected with webContents.insertCSS rather than edited into the themes. The
// theme objects are hand-written and stay that way — this is a runtime
// mitigation for one environment, not a design change, and it reverts by simply
// not being injected.
export const REMOTE_SESSION_CSS = `
  * {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
  }
`

// Floors for the main window. The window:resize handler clamps the requested
// size to the work area of the display it is on, which is correct — the
// renderer's preferred height does not fit a 1080p panel at 150% scaling. But
// the clamp had no floor, and its result is locked into BOTH the minimum and
// maximum size, so a degenerate work area (an RDP session whose virtual display
// comes up small before the client negotiates the real resolution, or a
// reconnect, or a mid-session DPI change) pinned the window to an unusable size
// that the user could not drag or maximise their way out of.
//
// MIN_WINDOW_WIDTH matches the renderer's MAIN_W: below it the layout overflows,
// which is what e2e/content-overflow.spec.js pins.
export const MIN_WINDOW_WIDTH = 480
export const MIN_WINDOW_HEIGHT = 400

// Clamp a requested window size to the work area without ever returning
// something unusable. An oversized window the user can move is recoverable; an
// 80px one locked to min == max is not.
export function clampWindowSize({ width, height, workAreaSize }) {
  // A non-positive work area is not a small screen, it is a bogus reading —
  // treat it as unknown and skip the ceiling entirely rather than clamping to
  // it and relying on the floor to rescue the result. Electron can report this
  // while a display is being reconfigured, which is exactly the RDP case.
  const usable = (n) => Number.isFinite(n) && n > 0
  const areaW = usable(workAreaSize?.width) ? workAreaSize.width : Infinity
  const areaH = usable(workAreaSize?.height) ? workAreaSize.height : Infinity
  return {
    width: Math.max(Math.min(width, areaW), MIN_WINDOW_WIDTH),
    height: Math.max(Math.min(height, areaH), MIN_WINDOW_HEIGHT)
  }
}
