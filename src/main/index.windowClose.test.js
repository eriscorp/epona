import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The main window's close guard (HTOO-456).
//
// Two things are pinned here, and both are about ORDER rather than outcome:
//
// 1. The first 'close' is cancelled synchronously. Electron reads
//    `defaultPrevented` the moment the listener's synchronous part returns, so
//    a guard that awaits `collectRepoRunning()` before calling preventDefault
//    has cancelled nothing — the window is gone before the question is asked.
//    That is how the handler was written before this card, and the double's
//    `close()` reproduces the real ordering so the regression is visible.
//
// 2. The window is hidden BEFORE the close is allowed through. A BrowserWindow
//    keeps a native background (default: opaque white) behind the renderer,
//    and it paints for the last frame or two while the compositor tears down.
//    Hiding first is what stops the white flash on quit. A test that only
//    checked `isVisible()` after the fact would pass with the hide anywhere,
//    including after the destroy — so the hide is observed relative to it.
//
// Its own file because closing the main window is terminal for the booted
// process, and index.test.js's cases all read the same window.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-window-close-'))

const harness = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  return createElectronDouble({
    pathsBase: mkdtemp(joinPath(tmp(), 'epona-window-close-paths-'))
  })
})

vi.mock('electron', () => harness.electron)

beforeAll(async () => {
  process.env.LOCALAPPDATA = sandbox
  await import('./index.js')
  await harness.ready()
})

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

// Record whether the window was still alive at each hide(), so the order of
// hide and destroy is an assertion rather than an inference.
function observeHide(win) {
  const destroyedAtHide = []
  const hide = win.hide.bind(win)
  win.hide = () => {
    destroyedAtHide.push(win.destroyed)
    hide()
  }
  return destroyedAtHide
}

describe('closing the main window with nothing running', () => {
  let main
  let destroyedAtHide

  it('cancels the first close synchronously, before anything is awaited', () => {
    main = harness.windows.at(-1)
    main.visible = true
    destroyedAtHide = observeHide(main)

    main.close()

    // The double destroys on return unless preventDefault ran during the
    // listener's synchronous part. Still alive here means the guard held.
    expect(main.destroyed).toBe(false)
  })

  it('then hides the window and lets the close through, without asking', async () => {
    await vi.waitFor(() => expect(main.destroyed).toBe(true))

    expect(main.visible).toBe(false)
    // Hidden at least once while still alive — never only after the destroy.
    expect(destroyedAtHide.length).toBeGreaterThan(0)
    expect(destroyedAtHide.every((wasDestroyed) => wasDestroyed === false)).toBe(true)
    // Nothing in repo mode was running, so no question was put.
    expect(harness.electron.dialog.showMessageBox).not.toHaveBeenCalled()
    // A window close is not a quit request; window-all-closed decides that.
    expect(harness.app.quit).not.toHaveBeenCalled()
  })
})

describe('closing the main window during an app quit', () => {
  // A cancelled 'close' also cancels the app.quit() that raised it. On macOS
  // that would leave the app running with no window, so a confirmed close that
  // began as a quit is re-issued as a quit rather than as a window close.
  it('re-issues app.quit() once the close is confirmed', async () => {
    // The macOS dock path gives us a fresh window with its own guard state.
    harness.emitAppEvent('activate')
    const main = harness.windows.at(-1)
    expect(main.destroyed).toBe(false)
    main.visible = true

    // before-quit is what arms the guard's quit path. Under the double the
    // shutdown sweep in that handler returns early (`app._eponaCleanupRan`
    // auto-vivifies truthy), so any app.quit() counted from here is the guard's.
    await harness.emitAppEvent('before-quit', { preventDefault: vi.fn() })
    const quitsBefore = harness.app.quit.mock.calls.length

    main.close()
    expect(main.destroyed).toBe(false)

    await vi.waitFor(() => expect(harness.app.quit.mock.calls.length).toBe(quitsBefore + 1))
    expect(main.visible).toBe(false)
    // The quit is what closes the window; the guard did not close it itself.
    expect(main.destroyed).toBe(false)
  })
})
