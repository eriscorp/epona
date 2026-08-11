// Renderer-boundary hardening, kept in ONE place so the policy is single-sourced
// and auditable rather than scattered across window constructors.
//
// Ported from dagda's `windowSecurity.ts` (itself from mabon's WP18 pass) and cut
// down to what epona actually has. Dagda carries window ROLES and a per-role
// channel allowlist because it runs a mini player and a Suno <webview> that share
// a preload. Epona has two windows — the main window and a splash — and the splash
// has no preload at all, so it cannot send IPC and there is nothing to grade. One
// trusted window, no roles.
//
// Three protections:
//
//   1. hardenWindow()  — deny top-level navigation away from our own content, and
//      deny every child window, handing validated external URLs to the OS instead.
//   2. guardIpc()      — wrap ipcMain so every handler rejects an IPC whose sender
//      is not the top frame of a known epona window at our own location.
//   3. Trusted-window bookkeeping that forgets a window when its webContents dies,
//      so a reused id cannot inherit trust.
//
// This is a SECOND gate. The zod schemas at each handler still validate every
// payload; nothing here replaces them.

import { pathToFileURL, fileURLToPath } from 'url'
import { isSafeExternalUrl } from '../shared/externalUrl.js'

/**
 * Locations we consider "our own content", each keyed as `protocol//host` plus
 * pathname. Query and hash are ignored so a future `?window=x` variant still
 * matches.
 *
 * Empty until `initWindowSecurity` runs, which fails CLOSED: before init nothing
 * is trusted, so a handler registered too early rejects rather than admits.
 */
let trustedLocations = []

/**
 * The key form above. One place, so init and lookup cannot disagree.
 *
 * **`host` explicitly, NOT `origin`.** For a `file:` URL the WHATWG parser
 * returns the opaque origin `"null"`, so an origin-based key carries no host
 * information at all and every `file://` host compares equal. That makes
 * `file://attacker.example/opt/Epona/.../index.html` indistinguishable from the
 * local path we actually trust — a page served from a remote share at a
 * mirroring path would satisfy both the `will-navigate` guard and the IPC sender
 * check, with our preload attached.
 *
 * The usual reassurance is that Windows is spared because a trusted path starts
 * with a drive letter and `C:` is not a legal UNC share name. That is a property
 * of the PATH, not of the platform: `pathToFileURL` on a UNC path yields a real
 * host and a pathname with no drive letter, and epona's nsis installer allows
 * the user to choose the install directory. The mac dmg and the Linux deb and
 * AppImage install under plain POSIX paths with no such accident at all, and
 * epona ships all of them.
 *
 * For `http`/`https` this is identical to `origin` — the parser normalises the
 * default port away — so nothing changes on the dev-server path.
 */
function locationKey(url) {
  if (url.protocol !== 'file:') return `${url.protocol}//${url.host}${url.pathname}`
  const canonical = canonicalFileUrl(url)
  // Windows paths are case-insensitive, and the drive letter is where the two
  // producers actually disagree: Chromium canonicalises it when it reports
  // frame.url, `pathToFileURL(__dirname + ...)` preserves whatever case the
  // module path carried. Comparing those verbatim is a LOCKOUT, not a safety
  // margin (see initWindowSecurity). `host` is NOT folded in here — it is
  // already lower-cased by the URL parser and stays compared exactly, which is
  // the half that keeps a remote share from mirroring our path.
  const pathname =
    process.platform === 'win32' ? canonical.pathname.toLowerCase() : canonical.pathname
  return `${canonical.protocol}//${canonical.host}${pathname}`
}

/**
 * Round-trip a `file:` URL through Node's own path conversion so both sides of
 * the comparison are spelled by the SAME encoder.
 *
 * Chromium and `pathToFileURL` do not have to agree on percent-encoding for a
 * path containing a space, a `%`, or a non-ASCII character — and they only have
 * to disagree once for every IPC in the app to be rejected. Decoding to a path
 * and re-encoding collapses every equivalent spelling onto one.
 *
 * Falls back to the URL untouched when the conversion throws (a `file:` URL
 * carrying an encoded separator, a UNC form Node declines). Failing to
 * canonicalise must leave the old exact comparison in place, never widen it.
 */
function canonicalFileUrl(url) {
  try {
    return pathToFileURL(fileURLToPath(url))
  } catch {
    return url
  }
}

/**
 * webContents.id values for windows we constructed. An IPC from a webContents
 * absent from this set — a devtools extension, an unexpected frame, anything we
 * did not create — is rejected outright.
 */
const trustedWindows = new Set()

/**
 * Record the renderer locations we trust. Call once at boot, before any window
 * loads. `devUrl` is `ELECTRON_RENDERER_URL` under `electron-vite dev` and
 * undefined otherwise; `prodIndexHtml` is the absolute path passed to `loadFile`.
 */
export function initWindowSecurity(devUrl, prodIndexHtml) {
  const locations = []
  if (devUrl) {
    try {
      locations.push(locationKey(new URL(devUrl)))
    } catch {
      // Malformed dev URL — leave it out and fail closed rather than guess.
    }
  }
  // pathToFileURL, never string concatenation. A path containing a space, a `#`
  // or a non-ASCII character produces a different file URL than the naive form,
  // and a trusted location that never matches is a LOCKOUT — every IPC rejected,
  // the app dead on arrival — not a safety margin. Epona's own install path is
  // under %LOCALAPPDATA%\Programs, which contains the user's name.
  locations.push(locationKey(pathToFileURL(prodIndexHtml)))
  trustedLocations = locations
}

/** True when `rawUrl` points at our own renderer content. */
function isTrustedLocation(rawUrl) {
  let key
  try {
    key = locationKey(new URL(rawUrl))
  } catch {
    return false // about:blank, a bare string, anything malformed
  }
  return trustedLocations.includes(key)
}

/**
 * Register a window we created, so its IPC is accepted. Forgotten when its
 * webContents is destroyed — Electron reuses ids, and a stale entry would hand
 * trust to whatever gets that id next.
 */
export function registerTrustedWindow(win) {
  const id = win.webContents.id
  trustedWindows.add(id)
  win.webContents.once('destroyed', () => trustedWindows.delete(id))
}

/**
 * Deny top-level navigation and every child window.
 *
 * `openExternal` is injected rather than imported so this module stays free of
 * an `electron` import and the unit tests need no electron stub. A navigation to
 * an outside URL is handed to the browser instead of merely blocked — otherwise
 * a plain `<a href>` in the renderer would silently do nothing.
 */
export function hardenWindow(win, { allowExternal, openExternal }) {
  win.webContents.setWindowOpenHandler((details) => {
    if (allowExternal && isSafeExternalUrl(details.url)) openExternal(details.url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedLocation(url)) return // our own content — e.g. a dev HMR full reload
    event.preventDefault()
    if (allowExternal && isSafeExternalUrl(url)) openExternal(url)
  })
}

/**
 * The authority check, with its reasoning kept rather than collapsed to a
 * boolean: `{ allowed }` on success, `{ allowed: false, reason, senderUrl }`
 * otherwise.
 *
 * The reason exists because this gate fails CLOSED and used to fail SILENTLY,
 * which is a brick. A location mismatch rejects every channel in the app — the
 * renderer never hydrates, so it never signals 'app:ready', so the window is
 * only revealed by the 15s backstop and every button is dead. That state is
 * indistinguishable from a slow, broken app unless the guard says why.
 */
export function senderVerdict(event) {
  const contents = event.sender
  if (!contents || contents.isDestroyed()) return { allowed: false, reason: 'destroyed-sender' }
  if (!trustedWindows.has(contents.id)) return { allowed: false, reason: 'unknown-window' }
  // Must be the window's OWN top frame. An iframe inherits the preload, so a
  // subframe reaching a privileged channel is exactly what this rejects.
  const frame = event.senderFrame
  if (!frame) return { allowed: false, reason: 'no-sender-frame' }
  if (frame !== contents.mainFrame) return { allowed: false, reason: 'subframe' }
  if (!isTrustedLocation(frame.url)) {
    return { allowed: false, reason: 'location-mismatch', senderUrl: frame.url }
  }
  return { allowed: true }
}

/**
 * Accept an IPC only from the top frame of a known epona window, at one of our
 * own locations. Exported for direct unit testing.
 */
export function isSenderAllowed(event) {
  return senderVerdict(event).allowed
}

/** The locations currently trusted. For diagnostics — a mismatch needs both sides. */
export function getTrustedLocations() {
  return [...trustedLocations]
}

/**
 * Wrap `ipcMain` so `.handle` / `.on` reject an untrusted sender before the real
 * handler runs. An `invoke` rejection surfaces as an error in the renderer; a
 * fire-and-forget `.on` is dropped silently.
 *
 * Returned as a Proxy so call sites read as ordinary `ipcMain` usage — the point
 * is that a handler added later is covered by construction rather than by
 * remembering to opt in.
 *
 * `onReject({ channel, reason, senderUrl, trusted })` is optional and injected,
 * so this module stays free of an `electron` import and the logger it feeds is
 * the caller's choice. It is the ONLY way a rejection becomes visible: the
 * `.on` path drops silently by design, and the `.handle` path throws into the
 * renderer, where a packaged build has no console to show it. A throwing
 * `onReject` is swallowed — a diagnostic must never take the guard down with it.
 */
export function guardIpc(ipcMain, { onReject } = {}) {
  const wrappers = new WeakMap()

  const report = (channel, verdict) => {
    if (!onReject) return
    try {
      onReject({
        channel,
        reason: verdict.reason,
        senderUrl: verdict.senderUrl,
        trusted: getTrustedLocations()
      })
    } catch {
      /* best effort — never let logging break IPC */
    }
  }

  return new Proxy(ipcMain, {
    get(target, prop, receiver) {
      if (prop === 'handle') {
        return (channel, listener) => {
          target.handle(channel, (event, ...args) => {
            const verdict = senderVerdict(event)
            if (!verdict.allowed) {
              report(channel, verdict)
              throw new Error(`IPC "${channel}" rejected: untrusted sender (${verdict.reason})`)
            }
            return listener(event, ...args)
          })
        }
      }
      if (prop === 'on') {
        return (channel, listener) => {
          const wrapped = (event, ...args) => {
            const verdict = senderVerdict(event)
            if (!verdict.allowed) return report(channel, verdict)
            listener(event, ...args)
          }
          wrappers.set(listener, wrapped)
          target.on(channel, wrapped)
          return receiver
        }
      }
      // `.on` registered a wrapper, so removal has to be remapped or it silently
      // removes nothing and the listener stays live.
      if (prop === 'off' || prop === 'removeListener') {
        return (channel, listener) => {
          target.removeListener(channel, wrappers.get(listener) ?? listener)
          return receiver
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

/** Test-only reset, so suites do not leak trusted state between cases. */
export function __resetWindowSecurityForTests() {
  trustedLocations = []
  trustedWindows.clear()
}
