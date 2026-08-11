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

// Two signals, in priority order.
//
// `systemRemoteSession` is GetSystemMetrics(SM_REMOTESESSION), supplied by
// main/remoteSessionNative.js. It queries the session live and is believed in
// BOTH directions when present.
//
// `sessionName` is %SESSIONNAME% — 'Console' locally, 'RDP-Tcp#NN' remotely —
// and is only a fallback now, because it LIES after a reconnect. Windows writes
// it at logon and never revises it, so RDP-ing into a machine that already has
// your session open at the console (which reconnects that session rather than
// creating a new one) leaves every process reporting 'Console' over RDP.
// Measured on a test machine: SESSIONNAME=Console with `query session` showing
// rdp-tcp#0 Active. That is the common case, not a corner, and it made this
// whole mechanism inert for the users who most needed it.
//
// Unset SESSIONNAME happens in some service and scheduled-task launch contexts;
// treat that as local, which is the safe fallback direction — a false positive
// needlessly disables the GPU for someone sitting at the machine.
//
// Neither signal detects Parsec, Sunshine, VNC or other non-RDP remote tools.
export function isRemoteSession({ platform, sessionName, systemRemoteSession } = {}) {
  if (platform !== 'win32') return false
  // Authoritative when we have it — including when it says NO. A live "not
  // remote" beats a stale environment variable claiming otherwise.
  if (typeof systemRemoteSession === 'boolean') return systemRemoteSession
  if (typeof sessionName !== 'string' || sessionName === '') return false
  return sessionName.toLowerCase() !== 'console'
}

// Read the real environment. Split from the predicate so tests can drive the
// predicate directly without mutating process.env.
//
// `systemRemoteSession` is injected rather than read here: this module is in
// src/shared and must not import node or electron, which is what keeps it
// unit-testable and portable to the sibling apps.
export function detectRemoteSession(proc = process, systemRemoteSession = null) {
  return isRemoteSession({
    platform: proc.platform,
    sessionName: proc.env?.SESSIONNAME,
    systemRemoteSession
  })
}

// Read the EPONA_DISABLE_GPU escape hatch. Returns true to force software
// rendering, false to force acceleration back on, or null for "not set — decide
// by detection".
//
// It answers in BOTH directions on purpose, and the direction that is easy to
// forget is the more useful one. Forcing it ON is how the remote-session branch
// gets exercised on a machine with no RDP access, which is most machines.
// Forcing it OFF is a user's only recourse if detection is ever wrong on their
// box — precisely because there is deliberately no UI toggle.
//
// One rule, not a list of accepted spellings: empty or unset is unset, '0' is
// off, anything else is on. An unrecognised value must NOT fall through to
// detection — that would read as an override that silently did nothing.
export function resolveGpuOverride(value) {
  if (typeof value !== 'string' || value === '') return null
  return value !== '0'
}

// The decision: should this process disable hardware acceleration?
//
// Deliberately separate from isRemoteSession, and not folded into it. That
// function's name is a CLAIM ABOUT THE WORLD — it must not start returning true
// for a machine that is plainly not in a remote session, or every later reader
// is misled by a debugging flag. This one is named for the decision, so an
// override sits inside it honestly.
export function shouldDisableHardwareAcceleration(proc = process, systemRemoteSession = null) {
  const override = resolveGpuOverride(proc.env?.EPONA_DISABLE_GPU)
  if (override !== null) return override
  return detectRemoteSession(proc, systemRemoteSession)
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
// text-shadow is the other half, and it is the half users actually SEE. Every
// fantasy theme sets a two-layer blurred shadow on MuiCssBaseline.body —
// `0 0 4px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.4)` — which is a blur radius on
// every glyph in the app, re-rasterised on every repaint. Reported directly:
// Epona's text looked "very squiggly" over RDP while oghma and mabon, which run
// the plain skeleton themes on the same connection, looked fine.
//
// -webkit-font-smoothing: antialiased switches text from subpixel (ClearType) to
// grayscale antialiasing. Subpixel AA places colour fringes on glyph edges to
// exploit the physical RGB stripe of a local panel; sent through RDP's lossy
// codec those fringes smear, which is the other half of "squiggly". There is no
// physical subpixel layout on the far end to exploit in the first place.
//
// box-shadow is deliberately NOT stripped: the theme shadows are mostly
// zero-blur offsets drawing carved panel edges, so removing them would restyle
// the app for no rendering saving.
export const REMOTE_SESSION_CSS = `
  * {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    text-shadow: none !important;
  }
  body {
    -webkit-font-smoothing: antialiased !important;
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
