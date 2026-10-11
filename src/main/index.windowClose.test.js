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
  // A quit asks its question in before-quit, BEFORE it stops anything, and
  // re-issues app.quit() only after the shutdown sweep. Electron then raises
  // before-quit again and closes each window. The close guard must let that
  // close through at once: a cancelled close also cancels the quit, and on
  // macOS that left the app running with no window. index.quit.test.js pins
  // the question itself, with a repo-mode server running.
  it('runs the sweep, quits, and then lets the window close without asking', async () => {
    // The macOS dock path gives us a fresh window with its own guard state.
    harness.emitAppEvent('activate')
    const main = harness.windows.at(-1)
    expect(main.destroyed).toBe(false)
    main.visible = true
    const destroyedAtHide = observeHide(main)

    const first = { preventDefault: vi.fn() }
    harness.emitAppEvent('before-quit', first)
    expect(first.preventDefault).toHaveBeenCalled()
    await vi.waitFor(() => expect(harness.app.quit).toHaveBeenCalledTimes(1))

    // The re-issued quit is not held.
    const second = { preventDefault: vi.fn() }
    harness.emitAppEvent('before-quit', second)
    expect(second.preventDefault).not.toHaveBeenCalled()

    main.close()
    expect(main.destroyed).toBe(true)
    expect(destroyedAtHide).toEqual([false])
    expect(harness.electron.dialog.showMessageBox).not.toHaveBeenCalled()
  })
})
