import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync, mkdtempSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The second-instance path.
//
// Its own file because the lock answer has to be false BEFORE index.js is
// imported — `requestSingleInstanceLock()` runs at module scope — and vi.mock is
// per-file, so this cannot share the booted process in index.test.js.
//
// What makes it worth a file of its own: losing the race must do NO setup. The
// comment at the top of the whenReady block says so, and the reason is that a
// second instance creating windows or a settings manager would race the first one
// on the same userData directory, which is the exact thing the lock exists to
// prevent. Nothing observable would go wrong on the developer's machine if this
// regressed — it would corrupt settings for a user who double-clicked twice.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-second-instance-'))

const harness = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  return createElectronDouble({
    singleInstanceLock: false,
    pathsBase: mkdtemp(joinPath(tmp(), 'epona-second-paths-'))
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

describe('a second instance', () => {
  it('quits instead of running', () => {
    expect(harness.app.quit).toHaveBeenCalled()
  })

  it('creates no windows', () => {
    // Not even the splash. A second splash would appear over the first instance's
    // window, always on top and with no taskbar entry to dismiss it from.
    expect(harness.windows).toEqual([])
  })

  it('registers no IPC handlers', () => {
    // The whole guarded surface belongs to the instance that owns userData.
    expect(harness.handlers.size).toBe(0)
    expect(harness.listeners.size).toBe(0)
  })

  it('writes nothing into the data directory it does not own', () => {
    // The failure this guards: two processes with the same settings.json open.
    // initSessionLog is called at module scope, before the lock is even checked,
    // so the only thing keeping this honest is that the ready block returns early
    // before the settings manager exists.
    const entries = readdirSync(sandbox, { withFileTypes: true }).map((e) => e.name)
    expect(entries).not.toContain('settings.json')
  })
})
