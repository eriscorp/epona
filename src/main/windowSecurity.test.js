import { describe, it, expect, beforeEach, vi } from 'vitest'
import { pathToFileURL } from 'url'
import {
  initWindowSecurity,
  registerTrustedWindow,
  isSenderAllowed,
  hardenWindow,
  guardIpc,
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
})
