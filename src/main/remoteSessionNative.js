import { createRequire } from 'module'

// The authoritative "am I in a Remote Desktop session?" check, isolated here so
// src/shared/remoteSession.js can stay pure and unit-testable.
//
// Why this exists at all: %SESSIONNAME% is written into a session's environment
// at logon and never revised. RDP into a machine that already has your session
// open at the console and Windows RECONNECTS that session instead of creating a
// new one — so every process in it keeps reporting SESSIONNAME=Console while
// running over RDP. Observed directly on a test machine: SESSIONNAME=Console and
// CLIENTNAME unset, with `query session` showing rdp-tcp#0 Active and Electron
// reporting the 1280x960 RDP virtual display. CLIENTNAME goes stale identically,
// so it is no help. That is not an exotic case — it is what happens to anyone
// who leaves a machine logged in and later connects to it remotely, and it made
// the entire remote-session adaptation silently inert for exactly those users.
//
// GetSystemMetrics(SM_REMOTESESSION) queries the session live and cannot go
// stale. It is a plain user32 call with no handle and no permissions to acquire,
// so it is safe before Electron's 'ready' event — which is mandatory here,
// because app.disableHardwareAcceleration() does nothing if called after it.
//
// The cost this trades against was named in an earlier version of
// shared/remoteSession.js: a .node load on the pre-ready boot path. That is the
// right thing to weigh, and it is a few milliseconds against a feature that
// otherwise does not work at all for reconnecting users. The addon is already a
// hard runtime dependency on Windows (the Legacy tab loads it), so this adds a
// load, not a dependency.
//
// createRequire, not import: da-win32 is a CommonJS native addon, marked
// rollup-external and asarUnpack'd. This mirrors targets/legacyTarget.js.

/**
 * @returns {boolean|null} true/false when the platform can answer authoritatively,
 *   null when it cannot — meaning "no opinion", so the caller falls back to the
 *   environment variable rather than treating silence as "not remote".
 */
export function detectRemoteSessionNative() {
  if (process.platform !== 'win32') return null
  try {
    const win32 = createRequire(import.meta.url)('da-win32')
    if (typeof win32?.isRemoteSession !== 'function') return null
    return Boolean(win32.isRemoteSession())
  } catch {
    // A missing or unloadable addon must not take the app down over a
    // rendering hint. Fall back to the env var, which is what shipped before.
    return null
  }
}
