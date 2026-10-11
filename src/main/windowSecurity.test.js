import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pathToFileURL, fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import {
  initWindowSecurity,
  registerTrustedWindow,
  isSenderAllowed,
  senderVerdict,
  getTrustedLocations,
  hardenWindow,
  guardIpc,
  installContentSecurityPolicy,
  withContentSecurityPolicy,
  RENDERER_CSP,
  DEV_RENDERER_CSP,
  SPLASH_CSP,
  __resetWindowSecurityForTests
} from './windowSecurity.js'

// These protections are not user-observable, so the tests are the only evidence
// they work. Drive them adversarially: every case below is a thing that SHOULD be
// refused, plus the minimum set that must still be allowed (a lockout is as much
// a failure as a hole).

const PROD_HTML =
  'C:\\Users\\a b\\AppData\\Local\\Programs\\Epona\\resources\\app.asar\\out\\renderer\\index.html'
const PROD_URL = pathToFileURL(PROD_HTML).href
const DEV_URL = 'http://localhost:5173/'

/** Minimal fakes — no electron import needed, which is the point of the injection. */
function fakeWindow(id) {
  const listeners = new Map()
  const mainFrame = { url: PROD_URL }
  const webContents = {
    id,
    mainFrame,
    isDestroyed: () => false,
    once: (evt, cb) => listeners.set(evt, cb),
    on: (evt, cb) => listeners.set(evt, cb),
    setWindowOpenHandler: (cb) => listeners.set('windowOpen', cb)
  }
  return { webContents, listeners, destroy: () => listeners.get('destroyed')?.() }
}

function fakeEvent(win, { frame, url } = {}) {
  const senderFrame = frame === null ? null : (frame ?? win.webContents.mainFrame)
  if (url && senderFrame) senderFrame.url = url
  return { sender: win.webContents, senderFrame }
}

beforeEach(() => {
  __resetWindowSecurityForTests()
})

describe('isSenderAllowed', () => {
  it('accepts the top frame of a registered window at our own location', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win))).toBe(true)
  })

  it('fails closed before init — nothing is trusted yet', () => {
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win))).toBe(false)
  })

  it('rejects a window we never registered', () => {
    initWindowSecurity(undefined, PROD_HTML)
    expect(isSenderAllowed(fakeEvent(fakeWindow(99)))).toBe(false)
  })

  it('rejects a subframe, which inherits the preload', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    const iframe = { url: PROD_URL } // same URL, but not === mainFrame
    expect(isSenderAllowed(fakeEvent(win, { frame: iframe }))).toBe(false)
  })

  it('rejects a missing sender frame', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win, { frame: null }))).toBe(false)
  })

  it('rejects a registered window that navigated somewhere else', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win, { url: 'https://example.com/' }))).toBe(false)
    expect(isSenderAllowed(fakeEvent(win, { url: 'about:blank' }))).toBe(false)
  })

  it('rejects a destroyed sender', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    win.webContents.isDestroyed = () => true
    expect(isSenderAllowed(fakeEvent(win))).toBe(false)
  })

  it('forgets a window when its webContents dies, so a reused id inherits nothing', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(7)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win))).toBe(true)
    win.destroy()
    expect(isSenderAllowed(fakeEvent(win))).toBe(false)
  })

  it('trusts the dev server URL as well when one is given', () => {
    initWindowSecurity(DEV_URL, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win, { url: DEV_URL }))).toBe(true)
    expect(isSenderAllowed(fakeEvent(win, { url: PROD_URL }))).toBe(true)
  })

  it('ignores a malformed dev URL rather than trusting everything', () => {
    initWindowSecurity('not a url', PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win, { url: PROD_URL }))).toBe(true)
    expect(isSenderAllowed(fakeEvent(win, { url: 'https://example.com/' }))).toBe(false)
  })

  it('matches a prod path containing a space — the lockout case', () => {
    // pathToFileURL percent-encodes the space; naive `file://${path}` would not,
    // and the mismatch would reject every IPC the app ever sends.
    initWindowSecurity(undefined, PROD_HTML)
    expect(PROD_URL).toContain('%20')
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win))).toBe(true)
  })

  it('ignores query and hash, so a ?window= variant still matches', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win, { url: `${PROD_URL}?panel=settings#top` }))).toBe(true)
  })

  it('rejects a remote file:// host whose path mirrors our own', () => {
    // A file: URL has the opaque origin "null", so an origin-based key carries NO
    // host information and every file:// host compares equal. Without the host in
    // the key, a page loaded from an attacker's share at a matching path is
    // accepted as our own content — with our preload attached.
    initWindowSecurity(undefined, PROD_HTML)

    // Derive the adversary from the trusted URL's OWN pathname, so the two differ
    // in host and nothing else. Spelling a path literal here instead would make
    // the test pass for the wrong reason: on win32 `pathToFileURL('/opt/x')`
    // resolves against the current drive and yields `/E:/opt/x`, which would
    // never have matched regardless of the key.
    const trusted = new URL(PROD_URL)
    const remote = `file://attacker.example${trusted.pathname}`
    expect(trusted.origin).toBe('null') // the reason this is a trap
    expect(new URL(remote).origin).toBe('null') // ...and why the two compared equal
    expect(new URL(remote).pathname).toBe(trusted.pathname) // differ only in host

    const win = fakeWindow(1)
    registerTrustedWindow(win)
    expect(isSenderAllowed(fakeEvent(win, { url: remote }))).toBe(false)
    // ...and the genuine local path still matches, so the fix did not overshoot.
    expect(isSenderAllowed(fakeEvent(win, { url: PROD_URL }))).toBe(true)
  })

  // The lockout half of this gate, which is the half that actually bit. A
  // trusted location that never matches rejects EVERY channel: the renderer
  // cannot hydrate, so it never signals app:ready, so the window appears only on
  // the 15s backstop showing default settings, with every IPC-backed control
  // dead while checkboxes and text fields carry on working. Each case below is a
  // way the two producers can spell the same file differently.
  describe('path canonicalisation', () => {
    it.runIf(process.platform === 'win32')(
      'matches when only the drive-letter case differs',
      () => {
        // Chromium canonicalises the drive letter when it reports frame.url;
        // pathToFileURL preserves whatever case __dirname carried. Comparing the
        // two verbatim bricks the app.
        initWindowSecurity(undefined, PROD_HTML)
        const win = fakeWindow(1)
        registerTrustedWindow(win)

        const lowerDrive = PROD_URL.replace(/^file:\/\/\/C:/, 'file:///c:')
        expect(lowerDrive).not.toBe(PROD_URL) // the disagreement is real
        expect(isSenderAllowed(fakeEvent(win, { url: lowerDrive }))).toBe(true)
      }
    )

    it.runIf(process.platform === 'win32')('matches a case difference anywhere in the path', () => {
      // NTFS is case-insensitive, so these are one file, not two.
      initWindowSecurity(undefined, PROD_HTML)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      expect(isSenderAllowed(fakeEvent(win, { url: PROD_URL.replace('AppData', 'appdata') }))).toBe(
        true
      )
    })

    it.runIf(process.platform !== 'win32')('keeps case significant on a case-sensitive OS', () => {
      // The win32 fold is Windows semantics, not a general loosening.
      const posixHtml = '/opt/Epona/resources/app.asar/out/renderer/index.html'
      initWindowSecurity(undefined, posixHtml)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      const url = pathToFileURL(posixHtml).href
      expect(isSenderAllowed(fakeEvent(win, { url }))).toBe(true)
      expect(isSenderAllowed(fakeEvent(win, { url: url.replace('/opt/', '/OPT/') }))).toBe(false)
    })

    it('matches a non-ASCII install path', () => {
      // %LOCALAPPDATA% contains the user's name, which is not required to be
      // ASCII. Canonicalising must not break the path it is there to rescue.
      const html = pathToFileURL(PROD_HTML).href.replace('a%20b', 'Jürgen')
      const decoded = fileURLToPath(html)
      initWindowSecurity(undefined, decoded)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      expect(isSenderAllowed(fakeEvent(win, { url: pathToFileURL(decoded).href }))).toBe(true)
    })

    it('still rejects a different file in the same directory', () => {
      // Canonicalising normalises spelling, not identity.
      initWindowSecurity(undefined, PROD_HTML)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      expect(
        isSenderAllowed(fakeEvent(win, { url: PROD_URL.replace('index.html', 'other.html') }))
      ).toBe(false)
    })
  })

  it.runIf(process.platform === 'win32')(
    'keys a UNC install path by its share host, which has no drive letter to save it',
    () => {
      // "Windows is spared because the path starts with a drive letter" is a
      // property of the PATH, not the platform. Epona's nsis installer lets the
      // user choose the directory, and a UNC one yields a real host and a
      // pathname with no drive letter — so under an origin-based key it was as
      // forgeable as the POSIX installs.
      const uncHtml = '\\\\fileserver\\apps\\Epona\\resources\\app.asar\\out\\renderer\\index.html'
      const uncUrl = pathToFileURL(uncHtml)
      expect(uncUrl.host).toBe('fileserver')
      expect(uncUrl.pathname.startsWith('/apps/')).toBe(true) // no drive letter

      initWindowSecurity(undefined, uncHtml)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      expect(isSenderAllowed(fakeEvent(win, { url: uncUrl.href }))).toBe(true)
      expect(
        isSenderAllowed(fakeEvent(win, { url: `file://attacker.example${uncUrl.pathname}` }))
      ).toBe(false)
    }
  )
})

describe('guardIpc', () => {
  function fakeIpcMain() {
    const handlers = new Map()
    const listeners = new Map()
    return {
      handle: (ch, fn) => handlers.set(ch, fn),
      on: (ch, fn) => listeners.set(ch, fn),
      removeListener: (ch, fn) => {
        if (listeners.get(ch) === fn) listeners.delete(ch)
      },
      handlers,
      listeners
    }
  }

  it('runs the real handler for a trusted sender', async () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    const raw = fakeIpcMain()
    const inner = vi.fn(() => 'ok')

    guardIpc(raw).handle('settings:load', inner)
    const result = await raw.handlers.get('settings:load')(fakeEvent(win), 'arg')

    expect(result).toBe('ok')
    expect(inner).toHaveBeenCalledWith(expect.anything(), 'arg')
  })

  it('throws for an untrusted invoke, and never reaches the handler', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const raw = fakeIpcMain()
    const inner = vi.fn()

    guardIpc(raw).handle('settings:save', inner)
    expect(() => raw.handlers.get('settings:save')(fakeEvent(fakeWindow(42)))).toThrow(
      /untrusted sender/
    )
    expect(inner).not.toHaveBeenCalled()
  })

  it('silently drops an untrusted fire-and-forget send', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const raw = fakeIpcMain()
    const inner = vi.fn()

    guardIpc(raw).on('window:close', inner)
    raw.listeners.get('window:close')(fakeEvent(fakeWindow(42)))
    expect(inner).not.toHaveBeenCalled()
  })

  it('delivers a trusted fire-and-forget send', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    registerTrustedWindow(win)
    const raw = fakeIpcMain()
    const inner = vi.fn()

    guardIpc(raw).on('window:minimize', inner)
    raw.listeners.get('window:minimize')(fakeEvent(win))
    expect(inner).toHaveBeenCalled()
  })

  it('remaps removeListener to the wrapper it actually registered', () => {
    const raw = fakeIpcMain()
    const guarded = guardIpc(raw)
    const inner = () => {}

    guarded.on('some:channel', inner)
    expect(raw.listeners.has('some:channel')).toBe(true)
    // Removing by the ORIGINAL function must work — without the remap this is a
    // silent no-op and the listener stays live forever.
    guarded.removeListener('some:channel', inner)
    expect(raw.listeners.has('some:channel')).toBe(false)
  })

  it('passes other ipcMain members through', () => {
    const raw = fakeIpcMain()
    raw.somethingElse = () => 'passthrough'
    expect(guardIpc(raw).somethingElse()).toBe('passthrough')
  })

  // Without these the gate is a brick: it fails closed and says nothing, so a
  // lockout looks like a slow app with dead buttons rather than a broken bridge.
  describe('onReject diagnostics', () => {
    it('reports a location mismatch with BOTH sides of the comparison', () => {
      initWindowSecurity(undefined, PROD_HTML)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      const raw = fakeIpcMain()
      const onReject = vi.fn()

      guardIpc(raw, { onReject }).handle('settings:load', vi.fn())
      expect(() =>
        raw.handlers.get('settings:load')(
          fakeEvent(win, { url: 'file:///D:/elsewhere/index.html' })
        )
      ).toThrow(/location-mismatch/)

      expect(onReject).toHaveBeenCalledWith({
        channel: 'settings:load',
        reason: 'location-mismatch',
        senderUrl: 'file:///D:/elsewhere/index.html',
        trusted: getTrustedLocations()
      })
      // The trusted side must not be empty, or the log names only the symptom.
      expect(getTrustedLocations().length).toBeGreaterThan(0)
    })

    it('reports the silently-dropped send path too — that is window:minimize', () => {
      initWindowSecurity(undefined, PROD_HTML)
      const raw = fakeIpcMain()
      const onReject = vi.fn()

      guardIpc(raw, { onReject }).on('window:minimize', vi.fn())
      raw.listeners.get('window:minimize')(fakeEvent(fakeWindow(42)))

      expect(onReject).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'window:minimize', reason: 'unknown-window' })
      )
    })

    it('never lets a throwing reporter take the guard down with it', () => {
      initWindowSecurity(undefined, PROD_HTML)
      const raw = fakeIpcMain()
      const inner = vi.fn()

      guardIpc(raw, {
        onReject: () => {
          throw new Error('log sink is on fire')
        }
      }).on('window:close', inner)

      expect(() => raw.listeners.get('window:close')(fakeEvent(fakeWindow(42)))).not.toThrow()
      expect(inner).not.toHaveBeenCalled() // still rejected, just also still alive
    })

    it('stays silent when a sender is allowed', () => {
      initWindowSecurity(undefined, PROD_HTML)
      const win = fakeWindow(1)
      registerTrustedWindow(win)
      const raw = fakeIpcMain()
      const onReject = vi.fn()

      guardIpc(raw, { onReject }).handle('settings:load', vi.fn())
      raw.handlers.get('settings:load')(fakeEvent(win))
      expect(onReject).not.toHaveBeenCalled()
    })
  })
})

describe('senderVerdict', () => {
  // The reason has to distinguish "the app is locked out of itself"
  // (location-mismatch) from the cases that mean something is genuinely wrong.
  it('names which gate refused', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)

    expect(senderVerdict(fakeEvent(win)).reason).toBe('unknown-window')
    registerTrustedWindow(win)
    expect(senderVerdict(fakeEvent(win))).toEqual({ allowed: true })
    expect(senderVerdict(fakeEvent(win, { frame: null })).reason).toBe('no-sender-frame')
    expect(senderVerdict(fakeEvent(win, { frame: { url: PROD_URL } })).reason).toBe('subframe')

    const mismatch = senderVerdict(fakeEvent(win, { url: 'https://example.com/' }))
    expect(mismatch.reason).toBe('location-mismatch')
    expect(mismatch.senderUrl).toBe('https://example.com/')

    win.webContents.isDestroyed = () => true
    expect(senderVerdict(fakeEvent(win)).reason).toBe('destroyed-sender')
  })
})

describe('hardenWindow', () => {
  it('denies every child window, opening safe URLs externally instead', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    const openExternal = vi.fn()
    hardenWindow(win, { allowExternal: true, openExternal })

    const handler = win.listeners.get('windowOpen')
    expect(handler({ url: 'https://hybrasyl.com/' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://hybrasyl.com/')

    openExternal.mockClear()
    expect(handler({ url: 'file:///C:/Windows/System32/calc.exe' })).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('never opens externally when the window is not allowed to', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    const openExternal = vi.fn()
    hardenWindow(win, { allowExternal: false, openExternal })

    expect(win.listeners.get('windowOpen')({ url: 'https://hybrasyl.com/' })).toEqual({
      action: 'deny'
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('blocks navigation away from our content and hands it to the browser', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    const openExternal = vi.fn()
    hardenWindow(win, { allowExternal: true, openExternal })

    const onNavigate = win.listeners.get('will-navigate')
    const event = { preventDefault: vi.fn() }
    onNavigate(event, 'https://example.com/phish')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://example.com/phish')
  })

  it('allows navigation to our own content, so a dev HMR reload still works', () => {
    initWindowSecurity(DEV_URL, PROD_HTML)
    const win = fakeWindow(1)
    const openExternal = vi.fn()
    hardenWindow(win, { allowExternal: true, openExternal })

    const event = { preventDefault: vi.fn() }
    win.listeners.get('will-navigate')(event, DEV_URL)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('blocks a dangerous-scheme navigation without opening it', () => {
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    const openExternal = vi.fn()
    hardenWindow(win, { allowExternal: true, openExternal })

    const event = { preventDefault: vi.fn() }
    win.listeners.get('will-navigate')(event, 'file:///C:/Windows/System32/calc.exe')

    expect(event.preventDefault).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('blocks navigation to a remote file:// host mirroring our own path', () => {
    // The same opaque-origin trap as the sender check — this guard reads the same
    // trusted set, so it was reachable the same way. Getting here means the page
    // is treated as our own content and loads WITH our preload.
    initWindowSecurity(undefined, PROD_HTML)
    const win = fakeWindow(1)
    const openExternal = vi.fn()
    hardenWindow(win, { allowExternal: true, openExternal })

    const remote = `file://attacker.example${new URL(PROD_URL).pathname}`
    const event = { preventDefault: vi.fn() }
    win.listeners.get('will-navigate')(event, remote)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled() // not a safe scheme either
  })
})

// ── Content-Security-Policy (HTOO-467) ──────────────────────────────────────

describe('content security policy', () => {
  // The two HTML files carry a copy of the policy as a meta tag, because a static
  // file cannot import a constant. A copy drifts, and a drifted CSP is invisible:
  // the header still applies, so the app works and the tag quietly stops
  // describing it. These read the files.
  const readRepoFile = (rel) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', rel), 'utf8')

  const metaContent = (html) => {
    const m = /http-equiv="Content-Security-Policy"\s*content="([^"]+)"/.exec(html)
    return m?.[1]
  }

  it('finds a meta policy in both documents', () => {
    // Guards the regex. If the tag is reformatted so this stops matching, the two
    // comparisons below compare undefined to undefined and pass.
    expect(metaContent(readRepoFile('src/renderer/index.html')), 'renderer meta').toBeTruthy()
    expect(metaContent(readRepoFile('resources/splash.html')), 'splash meta').toBeTruthy()
  })

  it('keeps the renderer meta tag in step with RENDERER_CSP', () => {
    expect(metaContent(readRepoFile('src/renderer/index.html'))).toBe(RENDERER_CSP)
  })

  it('keeps the splash meta tag in step with SPLASH_CSP', () => {
    expect(metaContent(readRepoFile('resources/splash.html'))).toBe(SPLASH_CSP)
  })

  it('allows no remote image', () => {
    expect(RENDERER_CSP).not.toMatch(/img-src[^;]*https?:/)
    expect(SPLASH_CSP).not.toMatch(/img-src[^;]*https?:/)
  })

  it('denies scripts entirely on the splash', () => {
    expect(SPLASH_CSP).toContain("default-src 'none'")
    expect(SPLASH_CSP).not.toContain('script-src')
    expect(SPLASH_CSP).not.toContain('unsafe-eval')
  })

  it('relaxes script-src in the dev policy only', () => {
    // Vite's react plugin injects its refresh preamble as an inline script, ahead
    // of the meta tag. The relaxation is real and is why the two strings differ;
    // this pins that it stays in dev.
    expect(DEV_RENDERER_CSP).toContain("'unsafe-inline'")
    expect(RENDERER_CSP).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(RENDERER_CSP).not.toContain('unsafe-eval')
  })

  it('carries no directive that Chromium ignores in a meta tag', () => {
    // Both strings are also meta tags. Chromium ignores frame-ancestors, sandbox
    // and report-uri there and logs a console error for each one.
    for (const policy of [RENDERER_CSP, SPLASH_CSP]) {
      expect(policy).not.toMatch(/frame-ancestors|sandbox|report-uri/)
    }
  })

  it('sets the policy on a policed response', () => {
    const out = withContentSecurityPolicy(PROD_URL, { 'X-Other': ['keep'] })
    expect(out['Content-Security-Policy']).toEqual([RENDERER_CSP])
    expect(out['X-Other']).toEqual(['keep'])
  })

  it('replaces any policy already on the response, whatever its case', () => {
    // Two CSP headers INTERSECT rather than override, so leaving one would make
    // the effective policy depend on whatever else set it.
    const out = withContentSecurityPolicy(PROD_URL, {
      'content-security-policy': ["default-src 'unsafe-inline'"],
      'Content-Security-Policy-Report-Only': ['whatever']
    })
    expect(Object.keys(out)).toEqual(['Content-Security-Policy'])
    expect(out['Content-Security-Policy']).toEqual([RENDERER_CSP])
  })

  it('gives the splash its own policy, not the renderer’s', () => {
    // A literal file URL, NOT pathToFileURL. On POSIX a Windows path handed to
    // pathToFileURL is a relative path whose backslashes are filename
    // characters, so the pathname ends `\splash.html` and the check does not
    // match: the test would fail on Linux and macOS and pass on Windows.
    const splashUrl = 'file:///C:/a%20b/resources/splash.html'
    expect(new URL(splashUrl).pathname.endsWith('/splash.html')).toBe(true)
    expect(withContentSecurityPolicy(splashUrl, {})['Content-Security-Policy']).toEqual([
      SPLASH_CSP
    ])
  })

  it('gives a posix-installed splash its own policy too', () => {
    // The deb and AppImage targets install under /opt, so the packaged splash URL
    // has no drive letter.
    const posix = 'file:///opt/Epona/resources/splash.html'
    expect(withContentSecurityPolicy(posix, {})['Content-Security-Policy']).toEqual([SPLASH_CSP])
  })

  it('does not mistake a file merely named like the splash for it', () => {
    // `endsWith('/splash.html')` and not `includes`: a file called
    // `not-splash.html` keeps the renderer policy and does not inherit one with
    // no script-src.
    const near = 'file:///opt/Epona/resources/not-splash.html'
    expect(withContentSecurityPolicy(near, {})['Content-Security-Policy']).toEqual([RENDERER_CSP])
  })

  it('leaves non-app schemes alone', () => {
    // devtools: most of all — a default-src 'self' breaks the inspector, and that
    // content is not ours to police.
    expect(withContentSecurityPolicy('devtools://devtools/bundled/x.js', {})).toBeUndefined()
    expect(withContentSecurityPolicy('chrome-extension://abc/y.js', {})).toBeUndefined()
  })

  it('polices a URL it cannot parse rather than letting it through', () => {
    // Fails closed, like the rest of this file. The header can only restrict.
    const out = withContentSecurityPolicy('not a url', {})
    expect(out['Content-Security-Policy']).toEqual([RENDERER_CSP])
  })

  it('installs one headers hook on the session', () => {
    const calls = []
    const fakeSession = { webRequest: { onHeadersReceived: (fn) => calls.push(fn) } }
    installContentSecurityPolicy(fakeSession, DEV_RENDERER_CSP)
    expect(calls).toHaveLength(1)

    let got
    calls[0]({ url: DEV_URL, responseHeaders: {} }, (r) => (got = r))
    expect(got.responseHeaders['Content-Security-Policy']).toEqual([DEV_RENDERER_CSP])
  })

  it('passes an empty object through when it declines to police', () => {
    // callback({}) leaves the response untouched; callback({ responseHeaders })
    // replaces the headers. The wrong one strips every header on a devtools load.
    const calls = []
    installContentSecurityPolicy({ webRequest: { onHeadersReceived: (fn) => calls.push(fn) } })
    let got
    calls[0]({ url: 'devtools://devtools/x.js', responseHeaders: { A: ['b'] } }, (r) => (got = r))
    expect(got).toEqual({})
  })
})
