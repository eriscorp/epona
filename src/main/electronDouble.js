// A stand-in for the `electron` module, good enough to boot src/main/index.js.
// TEST SUPPORT ONLY — nothing in the app imports this, and it is not bundled.
//
// It exists because of what HTOO-99 assumed and got wrong. That card says
// index.js has to be tested "in pieces, as handlers are extracted", and it
// suspected the reason was the `da-win32` ABI. It is neither: index.js imports
// fine under vitest, and the only thing standing between an import and the whole
// IPC surface is an `electron` double complete enough that `whenReady` runs to
// the end. Nothing had to be extracted.
//
// The design point: methods are auto-vivified rather than enumerated. A hand
// written double fails the moment index.js calls a window method nobody listed,
// and it fails as a swallowed rejection inside an uncaught `.then()` — which is
// how `win.webContents.once` cost time to find. Anything not explicitly
// overridden here answers with a `vi.fn()`, so a new call site does not break the
// harness, and the explicit overrides are only the ones whose RETURN value the
// boot path depends on.

import { vi } from 'vitest'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { tmpdir } from 'os'

// An object that answers any unknown property with a remembered vi.fn(). The
// same function comes back each time, so a test can assert on calls.
function autoStub(overrides = {}) {
  const generated = new Map()
  return new Proxy(overrides, {
    get(target, prop) {
      if (prop in target) return target[prop]
      if (typeof prop === 'symbol') return undefined
      if (!generated.has(prop)) generated.set(prop, vi.fn())
      return generated.get(prop)
    }
  })
}

let nextWebContentsId = 1

// The renderer side of a window. `id` and `mainFrame` are real values because
// windowSecurity's sender check compares them, and `once` must actually record
// the 'destroyed' listener registerTrustedWindow installs.
function makeWebContents(url) {
  const id = nextWebContentsId++
  const events = new Map()
  const mainFrame = { url }
  return autoStub({
    id,
    mainFrame,
    isDestroyed: () => false,
    send: vi.fn(),
    on: vi.fn(),
    once: (event, handler) => events.set(event, handler),
    emit: (event, ...args) => events.get(event)?.(...args),
    setWindowOpenHandler: vi.fn(),
    session: autoStub({ webRequest: autoStub({}) })
  })
}

/**
 * Build the double.
 *
 * `rendererUrl` is the location the window reports as loaded. It must match what
 * `initWindowSecurity` is given, or every IPC is rejected as untrusted — that is
 * the fail-closed direction, and it makes an unrelated test look like a security
 * regression, so it is a constructor argument rather than a default.
 */
export function createElectronDouble({
  singleInstanceLock = true,
  isPackaged = false,
  version = '2.7.2',
  // Every app.getPath() key resolves under here.
  //
  // NOT optional in practice, and the reason is sharp: booting index.js runs
  // `initSessionLog`, which writes files, and `removeStrayRoamingData`, which
  // calls rmSync on a directory derived from app.getPath('appData'). Pointed at a
  // developer's real paths, a test run would write into — and delete inside —
  // their actual Epona data. A caller should pass a temp directory, and the
  // default is a path that exists nowhere rather than anything plausible.
  pathsBase = join(tmpdir(), 'epona-electron-double-unset')
} = {}) {
  const handlers = new Map()
  const listeners = new Map()
  const windows = []
  const appEvents = new Map()
  let resolveReady

  const readyPromise = new Promise((resolve) => {
    resolveReady = resolve
  })

  const app = autoStub({
    isPackaged,
    setPath: vi.fn(),
    // Key-aware on purpose. A double that answers every key with the same path
    // makes `removeStrayRoamingData` compare appData against userData, find them
    // equal, and take its own safety early-return — so the test would pass while
    // proving nothing about the guard it appears to exercise.
    getPath: vi.fn((key) => join(pathsBase, String(key ?? 'unknown'))),
    getName: vi.fn(() => 'epona'),
    getVersion: vi.fn(() => version),
    getAppPath: vi.fn(() => 'C:\\app'),
    requestSingleInstanceLock: vi.fn(() => singleInstanceLock),
    quit: vi.fn(),
    exit: vi.fn(),
    whenReady: vi.fn(() => readyPromise),
    on: vi.fn((event, handler) => appEvents.set(event, handler)),
    once: vi.fn((event, handler) => appEvents.set(event, handler)),
    commandLine: autoStub({ appendSwitch: vi.fn() })
  })

  class BrowserWindow {
    constructor(options = {}) {
      this.options = options
      this.webContents = makeWebContents('file:///C:/app/out/renderer/index.html')
      this.destroyed = false
      this.visible = false
      this.events = new Map()
      windows.push(this)
    }
    static getAllWindows() {
      return windows.filter((w) => !w.destroyed)
    }
    // Loading updates the frame's URL, as the real thing does. That is what makes
    // the sender guard pass without a test having to hand-compute a trusted
    // location: index.js gives initWindowSecurity and loadFile the same path, so
    // agreeing with it here means agreeing by construction. pathToFileURL, not
    // string concatenation — windowSecurity keys on the same function, and this
    // repo's checkout path has a space in it, which the naive form encodes
    // differently.
    loadFile(path) {
      this.loadedFile = path
      this.webContents.mainFrame.url = pathToFileURL(path).href
      return Promise.resolve()
    }
    loadURL(url) {
      this.loadedUrl = url
      this.webContents.mainFrame.url = url
      return Promise.resolve()
    }
    on(event, handler) {
      this.events.set(event, handler)
      return this
    }
    once(event, handler) {
      this.events.set(event, handler)
      return this
    }
    emit(event, ...args) {
      return this.events.get(event)?.(...args)
    }
    show() {
      this.visible = true
    }
    hide() {
      this.visible = false
    }
    focus() {}
    isVisible() {
      return this.visible
    }
    isDestroyed() {
      return this.destroyed
    }
    isMinimized() {
      return false
    }
    restore() {}
    destroy() {
      this.destroyed = true
      this.emit('closed')
    }
    close() {
      this.destroy()
    }
    minimize() {}
    setSize() {}
    setMenu() {}
    getBounds() {
      return { x: 0, y: 0, width: 1100, height: 700 }
    }
    setBounds() {}
    removeMenu() {}
  }

  const electron = {
    app,
    BrowserWindow,
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      handleOnce: (channel, handler) => handlers.set(channel, handler),
      removeHandler: (channel) => handlers.delete(channel),
      on: (channel, handler) => listeners.set(channel, handler),
      removeListener: (channel) => listeners.delete(channel)
    },
    dialog: autoStub({
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
      showErrorBox: vi.fn()
    }),
    shell: autoStub({
      openPath: vi.fn(async () => ''),
      openExternal: vi.fn(async () => {})
    }),
    clipboard: autoStub({ writeText: vi.fn(), readText: vi.fn(() => '') }),
    screen: autoStub({
      getPrimaryDisplay: vi.fn(() => ({
        workAreaSize: { width: 1920, height: 1080 },
        bounds: { x: 0, y: 0, width: 1920, height: 1080 }
      })),
      getAllDisplays: vi.fn(() => [])
    }),
    nativeImage: autoStub({ createFromPath: vi.fn(() => autoStub({})) }),
    Menu: autoStub({ setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn(() => autoStub({})) })
  }

  // An IPC event the sender check will accept: a top frame of a window we
  // created, at the location initWindowSecurity was told to trust.
  function trustedEventFor(window) {
    // The LAST window created, which is the main one. The splash is created first
    // and is deliberately never registered as trusted — it has no preload and no
    // IPC needs — so defaulting to windows[0] would produce an event the guard is
    // right to reject, and read as a broken guard rather than a broken test.
    const target = window ?? windows.at(-1)
    return { sender: target.webContents, senderFrame: target.webContents.mainFrame }
  }

  return {
    electron,
    app,
    handlers,
    listeners,
    windows,
    /** Resolve app.whenReady() and let the boot chain settle. */
    async ready() {
      resolveReady()
      // Several microtask turns: the boot path awaits inside the .then().
      for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r))
    },
    /** Fire an app-level event index.js registered ('before-quit', etc.). */
    emitAppEvent(event, ...args) {
      return appEvents.get(event)?.(...args)
    },
    appEvents,
    trustedEventFor,
    // Both invoke helpers are async even for a handler that is synchronous or
    // throws, because that is what `ipcRenderer.invoke` does: it always hands the
    // renderer a promise. A helper that rethrew synchronously would make callers
    // write assertions that could not hold against the real thing.
    /** Call a handler the way ipcRenderer.invoke would, as a trusted sender. */
    async invoke(channel, ...args) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`no handler registered for "${channel}"`)
      return handler(trustedEventFor(), ...args)
    },
    /** Call a handler as something we never created. */
    async invokeUntrusted(channel, ...args) {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`no handler registered for "${channel}"`)
      const foreign = makeWebContents('https://evil.example/index.html')
      return handler({ sender: foreign, senderFrame: foreign.mainFrame }, ...args)
    },
    /** Deliver a fire-and-forget ipc.on message as a trusted sender. */
    send(channel, ...args) {
      const listener = listeners.get(channel)
      if (!listener) throw new Error(`no listener registered for "${channel}"`)
      return listener(trustedEventFor(), ...args)
    }
  }
}
