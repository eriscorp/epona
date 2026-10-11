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
// Four protections:
//
//   1. hardenWindow()  — deny top-level navigation away from our own content, and
//      deny every child window, handing validated external URLs to the OS instead.
//   2. guardIpc()      — wrap ipcMain so every handler rejects an IPC whose sender
//      is not the top frame of a known epona window at our own location.
//   3. Trusted-window bookkeeping that forgets a window when its webContents dies,
//      so a reused id cannot inherit trust.
//   4. installContentSecurityPolicy() — put the CSP on the RESPONSE, so it is in
//      force before a document runs rather than once parsing reaches a meta tag,
//      and so it covers the splash, which shipped with no policy of its own
//      (HTOO-467, ported from creidhne).
//
// This is a SECOND gate. The zod schemas at each handler still validate every
// payload; nothing here replaces them.

import { pathToFileURL, fileURLToPath } from 'url'
import { isSafeExternalUrl } from '../shared/externalUrl.js'

/**
 * The packaged renderer's Content-Security-Policy, single-sourced here.
 *
 * Each source and why it stays:
 * - `file:` on `img-src` — the packaged document and its assets load from disk.
 * - `data:` on `img-src` — Vite inlines an asset under `assetsInlineLimit` (4 KB)
 *   as a base64 URI. No image is that small today, but that is a build threshold
 *   and not a guarantee.
 * - `'unsafe-inline'` on `style-src` — MUI (emotion) writes `<style>` tags at run
 *   time.
 *
 * Fonts are `@fontsource` files that the build emits beside the bundle, so
 * `default-src 'self'` covers them. Epona plays no audio and loads no remote
 * image: the renderer fetches nothing, and main does every network call.
 *
 * `frame-ancestors` is NOT here, as it is in creidhne. Chromium ignores that
 * directive in a meta tag and logs a console error for it, and this string is
 * also the meta tag. A top-level BrowserWindow has no ancestor to police.
 *
 * **This string is duplicated as a `<meta http-equiv>` in
 * `src/renderer/index.html`, and the duplication is deliberate.** A static HTML
 * file cannot import a JS constant, and the tag is a second layer: it survives a
 * session this code never touches. `windowSecurity.test.js` reads that file and
 * asserts it still matches this constant, so the two copies cannot drift.
 */
export const RENDERER_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' file: data:; object-src 'none'; base-uri 'none'; form-action 'none';"

/**
 * The policy for `npm run dev`, where Vite serves the renderer over http.
 *
 * **`script-src` is relaxed here and nowhere else.** `@vitejs/plugin-react`
 * injects its refresh preamble as an *inline* script ahead of the meta tag in
 * `index.html`. A meta policy governs only what the parser reaches after it, so
 * the tag never blocked the preamble. A header governs the whole response, so
 * the packaged `script-src 'self'` stops `npm run dev` dead. `'unsafe-eval'` goes
 * with it because dependency pre-bundling can emit `eval`, and `ws:` because HMR
 * is a websocket.
 *
 * **The two policies differ, so a `script-src` violation cannot show in dev.**
 * That is why tests and the meta tag pin the packaged policy, rather than a
 * person exercising it by hand.
 */
export const DEV_RENDERER_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' file: data: blob:; " +
  "connect-src 'self' ws: http: https:; object-src 'none'; base-uri 'none'; form-action 'none';"

/**
 * The splash's policy. It is much narrower than the renderer's because the
 * splash is much smaller: `splash.html` has no preload, no bridge, no script of
 * any kind, one local image and one inline `<style>`. Its fonts are system
 * fonts, which `font-src` does not govern.
 *
 * So `default-src 'none'` and no `script-src` at all. The exposure today is
 * nil, because the content is entirely ours. The policy is there because this is
 * the file a later change is most likely to add a font, an image or a script to,
 * and where nobody would see that there was no policy to violate.
 *
 * `img-src file:` and not `'self'`: the splash always loads with `loadFile`, and
 * `'self'` against an opaque `file:` origin is not something to rely on.
 *
 * Duplicated as a meta tag in `resources/splash.html`, pinned the same way.
 */
export const SPLASH_CSP =
  "default-src 'none'; img-src file: data:; style-src 'unsafe-inline'; " +
  "base-uri 'none'; form-action 'none';"

/**
 * Schemes our own documents and their subresources load over: `file:` packaged,
 * `http:`/`https:` for the dev server.
 *
 * An allowlist and not a denylist, because the alternative puts a policy on
 * Chromium's own internal responses. `devtools:` is the important one: a
 * `default-src 'self'` breaks the inspector for no security gain, because that
 * content is not ours to police.
 */
const POLICED_PROTOCOLS = new Set(['file:', 'http:', 'https:'])

/** True for the splash document, which gets the narrower policy. */
function isSplashUrl(rawUrl) {
  try {
    return new URL(rawUrl).pathname.endsWith('/splash.html')
  } catch {
    return false
  }
}

/**
 * The response headers to send back, or `undefined` to leave the response
 * untouched. Exported for direct unit testing — a CSP is only worth having if
 * the exact header that reaches the document is pinned.
 *
 * Any policy already on the response is REPLACED, and header names compare
 * case-insensitively. Two CSP headers intersect rather than override, so a
 * policy left in place makes the effective policy depend on whatever else set
 * it. The report-only variant goes for the same reason: a stale one reports
 * against a policy we no longer send.
 *
 * A URL that will not parse gets a policy and does not escape one. The rest of
 * this file fails closed and so does this: the header can only restrict.
 */
export function withContentSecurityPolicy(rawUrl, responseHeaders, policy = RENDERER_CSP) {
  try {
    if (!POLICED_PROTOCOLS.has(new URL(rawUrl).protocol)) return undefined
  } catch {
    /* unparseable — fall through and police it */
  }
  const next = {}
  for (const [name, value] of Object.entries(responseHeaders ?? {})) {
    const lower = name.toLowerCase()
    if (lower === 'content-security-policy') continue
    if (lower === 'content-security-policy-report-only') continue
    next[name] = value
  }
  next['Content-Security-Policy'] = [isSplashUrl(rawUrl) ? SPLASH_CSP : policy]
  return next
}

/**
 * Put a CSP on every response this session serves for our own content.
 *
 * Call once, on `session.defaultSession`, before any window loads. A header is
 * in force for the response itself, and a document that is already loading has
 * passed it.
 *
 * `onHeadersReceived` keeps ONE listener per session, and a second registration
 * silently replaces the first. Nothing else in Epona may register one, and an
 * e2e spec must not hook it to read the header back: that removes this policy.
 *
 * `policy` is the RENDERER policy. The splash always gets `SPLASH_CSP`, because
 * its needs do not change between dev and packaged. The caller passes
 * `DEV_RENDERER_CSP` only when the window loads the dev server.
 */
export function installContentSecurityPolicy(session, policy = RENDERER_CSP) {
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = withContentSecurityPolicy(details.url, details.responseHeaders, policy)
    callback(responseHeaders ? { responseHeaders } : {})
  })
}

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
