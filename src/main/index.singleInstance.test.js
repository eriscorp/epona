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
// What makes it worth a file of its own: losing the race must do NO work. A
// second instance that creates windows, a settings manager or a session log
// races the first one on the same userData directory, which is the exact thing
// the lock exists to prevent. Nothing observable goes wrong on the developer's
// machine if this regresses — it corrupts settings and rotates the log set for a
// user who double-clicked twice.
//
// The real app.exit() stops the process on the statement. The double's exit is
// a no-op by default, and under a no-op the module keeps running, so every
// assertion below would test code that the real process never reaches (HTOO-351).
// Here exit throws a sentinel instead. The import stops where the real process
// stops, and the assertions see what a bounced launch really does.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-second-instance-'))

class ExitCalled extends Error {}

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

let importError
let uncaughtBefore

beforeAll(async () => {
  process.env.LOCALAPPDATA = sandbox
  uncaughtBefore = process.listenerCount('uncaughtException')
  harness.app.exit.mockImplementation(() => {
    throw new ExitCalled()
  })
  try {
    await import('./index.js')
  } catch (err) {
    importError = err
  }
  await harness.ready()
})

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true })
})

describe('a second instance', () => {
  it('exits on the lock check, with app.exit(0) and not app.quit()', () => {
    // The sentinel proves that module execution stopped AT the exit call. Any
    // other error means index.js failed for another reason first.
    expect(importError).toBeInstanceOf(ExitCalled)
    expect(harness.app.exit).toHaveBeenCalledWith(0)
    expect(harness.app.quit).not.toHaveBeenCalled()
  })

  it('installs no global error handlers', () => {
    // installGlobalErrorHandlers is the first module-scope statement below the
    // lock. Under app.quit() it ran in every bounced launch.
    expect(process.listenerCount('uncaughtException')).toBe(uncaughtBefore)
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
    // The failure this guards: two processes with the same settings.json open,
    // and a bounced launch that touches and rotates the owner's session logs.
    // The sandbox is the whole LOCALAPPDATA, so it must stay empty.
    expect(readdirSync(sandbox, { recursive: true })).toEqual([])
  })
})
