import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const created = []
// Set by the one test that needs loadFile to fail. On the mock rather than swapped
// in per test, because redefining an ES module's export to inject a different
// class is a trick that outlives its usefulness the moment anyone reads it.
const loadFailure = { error: null }

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options) {
      this.options = options
      this.events = new Map()
      this.destroyed = false
      this.visible = false
      this.shows = 0
      this.loaded = null
      created.push(this)
    }
    loadFile(path) {
      this.loaded = path
      return loadFailure.error ? Promise.reject(loadFailure.error) : Promise.resolve()
    }
    once(event, handler) {
      this.events.set(event, handler)
    }
    on(event, handler) {
      this.events.set(event, handler)
    }
    emit(event) {
      this.events.get(event)?.()
    }
    show() {
      this.shows++
      this.visible = true
    }
    isVisible() {
      return this.visible
    }
    isDestroyed() {
      return this.destroyed
    }
    destroy() {
      this.destroyed = true
    }
  }
}))

const { createSplashWindow } = await import('./splash.js')

beforeEach(() => {
  created.length = 0
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createSplashWindow', () => {
  it('creates a frameless, always-on-top window that starts hidden', () => {
    const splash = createSplashWindow()
    expect(splash.options).toMatchObject({
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      resizable: false
    })
  })

  it('gives the splash no preload and keeps it sandboxed', () => {
    // It has no IPC needs. A preload here would be reachable surface for nothing,
    // and guardIpc never registers this window as trusted anyway.
    const splash = createSplashWindow()
    expect(splash.options.webPreferences).toEqual({ sandbox: true })
    expect(splash.options.webPreferences.preload).toBeUndefined()
  })

  it('uses an opaque background rather than transparency', () => {
    // Transparent frameless windows fail to render on some GPUs, which for a
    // splash means the user stares at nothing for the whole boot.
    const splash = createSplashWindow()
    expect(splash.options.transparent).toBeUndefined()
    expect(splash.options.backgroundColor).toBe('#0c1524')
  })

  it('shows itself as soon as the window says it is ready', () => {
    const splash = createSplashWindow()
    expect(splash.visible).toBe(false)
    splash.emit('ready-to-show')
    expect(splash.shows).toBe(1)
  })

  it('shows itself anyway when ready-to-show never fires', () => {
    // The failure this backstop exists for: 'ready-to-show' is unreliable for
    // frameless windows on Windows, and without the timer the splash would stay
    // invisible for the entire boot while still being always-on-top.
    const splash = createSplashWindow()
    vi.advanceTimersByTime(500)
    expect(splash.shows).toBe(1)
  })

  it('shows once when both the event and the timer fire', () => {
    const splash = createSplashWindow()
    splash.emit('ready-to-show')
    vi.advanceTimersByTime(1000)
    expect(splash.shows).toBe(1)
  })

  it('destroys itself if a failed boot leaves it behind', () => {
    // An alwaysOnTop, skipTaskbar window that outlives boot cannot be focused,
    // closed, or found in the taskbar — the user has to kill the process.
    const splash = createSplashWindow()
    vi.advanceTimersByTime(19999)
    expect(splash.destroyed).toBe(false)
    vi.advanceTimersByTime(1)
    expect(splash.destroyed).toBe(true)
  })

  it('self-destructs later than the reveal backstop in index.js', () => {
    // 20s here against the 15s reveal timer: this must only fire when that path
    // has already failed, or it would tear down a splash that was about to be
    // replaced properly.
    const splash = createSplashWindow()
    vi.advanceTimersByTime(15000)
    expect(splash.destroyed).toBe(false)
  })

  it('cancels both timers when it is closed normally', () => {
    // Otherwise the self-destruct fires on an already-destroyed window, and the
    // show timer calls show() on it.
    const splash = createSplashWindow()
    splash.emit('closed')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not show a window that was destroyed before the timer fired', () => {
    const splash = createSplashWindow()
    splash.destroy()
    vi.advanceTimersByTime(500)
    expect(splash.shows).toBe(0)
  })

  it('survives a splash asset that fails to load', async () => {
    // A missing resources/splash.html must not take the boot down with it — the
    // main window is what matters and it is created straight after this returns.
    loadFailure.error = new Error('ENOENT')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => createSplashWindow()).not.toThrow()
      await Promise.resolve()
      expect(consoleError).toHaveBeenCalledWith('Failed to load splash:', loadFailure.error)
    } finally {
      consoleError.mockRestore()
      loadFailure.error = null
    }
  })

  it('loads its markup from resources/, resolved from __dirname', () => {
    // Not app.getAppPath(): under the e2e harness that returns the entry file's
    // own directory, so the read would miss in one of the three launch modes.
    // See CLAUDE.md.
    const splash = createSplashWindow()
    expect(splash.loaded).toMatch(/resources[\\/]splash\.html$/)
  })
})
