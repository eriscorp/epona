import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync, rmSync, mkdtempSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

// The main process, booted.
//
// HTOO-99 said this file had to wait for handlers to be "extracted", and
// suspected the `da-win32` ABI was why. Neither is true: index.js imports under
// vitest as it stands, and driving app.whenReady() to completion registers all
// forty IPC handlers. What it needed was an `electron` double complete enough not
// to throw halfway through boot — see electronDouble.js. Nothing was extracted to
// make this file possible.
//
// Boot happens ONCE for the whole file. index.js is a module with side effects and
// cannot be re-imported per test, so these read as assertions about one booted
// process rather than as independent cases. The single-instance path needs a
// different lock answer before import, so it lives in its own file.

const here = dirname(fileURLToPath(import.meta.url))

// A throwaway directory for every app.getPath() key AND for %LOCALAPPDATA%.
// Both matter: index.js derives dataDir from LOCALAPPDATA on Windows and from
// app.getPath('appData') elsewhere, then writes a session log into it and calls
// rmSync on a sibling. Pointed anywhere real, a test run would touch a
// developer's own Epona data.
const sandbox = mkdtempSync(join(tmpdir(), 'epona-main-boot-'))

const harness = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  return createElectronDouble({
    pathsBase: mkdtemp(joinPath(tmp(), 'epona-main-paths-'))
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

describe('booting the main process', () => {
  it('registers its IPC surface only after ready, never at import', () => {
    // Pinned because the failure mode is silence: a handler registered before
    // initWindowSecurity runs would be guarded against an empty trusted-location
    // list, which rejects everything. bootOrder.test.js pins the same invariant
    // from the source side; this one observes it happening.
    expect(harness.handlers.size).toBeGreaterThan(30)
    expect(harness.listeners.size).toBeGreaterThan(0)
  })

  it('shows a splash window and creates the main window hidden', () => {
    expect(harness.windows.length).toBeGreaterThanOrEqual(2)
    const main = harness.windows.at(-1)
    expect(main.options.show).toBe(false)
  })

  it('pins userData to Local rather than Roaming', () => {
    // The Roaming default is what the migration in this file exists to undo, and
    // it has to be set at module load — after Chromium resolves it, setPath is a
    // no-op that fails silently.
    const call = harness.app.setPath.mock.calls.find(([key]) => key === 'userData')
    expect(call).toBeTruthy()
    expect(call[1]).toContain(join('Erisco', 'Epona'))
  })
})

describe('the IPC sender guard', () => {
  // CLAUDE.md: "Register IPC handlers on `ipc`, never the raw `ipcMain`."
  // guardIpc wraps ipcMain once so the check applies by construction, and a
  // handler added on the raw import silently opts out. This is that warning
  // turned into a test — and it is a behavioural one, so it does not care how
  // the registration was written.
  it('rejects every invoke handler when the sender is not one of our windows', async () => {
    const unguarded = []
    for (const channel of harness.handlers.keys()) {
      try {
        await harness.invokeUntrusted(channel)
        unguarded.push(channel)
      } catch (error) {
        if (!/untrusted sender/.test(error.message)) unguarded.push(`${channel} (${error.message})`)
      }
    }
    // A handler registered on the raw ipcMain would run and reach here without
    // throwing, so an empty list is the whole assertion.
    expect(unguarded).toEqual([])
  })

  it('covers every channel it registers, with none opted out', () => {
    expect(harness.handlers.size).toBe(41)
  })

  it('drops a fire-and-forget message from an untrusted sender', () => {
    // guardIpc rejects `.on` silently rather than throwing — there is no reply
    // channel to reject into. So the observable is that nothing happened.
    const main = harness.windows.at(-1)
    const before = main.visible
    const listener = harness.listeners.get('window:minimize')
    expect(listener).toBeTruthy()
    const foreign = { sender: { id: 9999, isDestroyed: () => false }, senderFrame: null }
    expect(() => listener(foreign)).not.toThrow()
    expect(main.visible).toBe(before)
  })
})

describe('the preload and the main process agree on channels', () => {
  // A preload method forwarding to a channel main never registers is a runtime
  // failure with no build-time signal, and the reverse is dead code. Read as
  // source rather than imported: the preload needs its own electron mock, and one
  // file cannot hold two.
  const preload = readFileSync(join(here, '..', 'preload', 'index.js'), 'utf8')

  function channelsFrom(method) {
    const found = new Set()
    const pattern = new RegExp(`ipcRenderer\\.${method}\\(\\s*'([^']+)'`, 'g')
    for (const match of preload.matchAll(pattern)) found.add(match[1])
    return found
  }

  it('registers a handler for every channel the preload invokes', () => {
    const invoked = channelsFrom('invoke')
    expect(invoked.size).toBeGreaterThan(20)
    const missing = [...invoked].filter((c) => !harness.handlers.has(c))
    expect(missing).toEqual([])
  })

  it('registers a listener for every channel the preload sends', () => {
    const sent = channelsFrom('send')
    expect(sent.size).toBeGreaterThan(0)
    const missing = [...sent].filter((c) => !harness.listeners.has(c))
    expect(missing).toEqual([])
  })

  it('has no invoke handler the preload cannot reach', () => {
    // Dead channels are worth knowing about: an unreachable handler is either a
    // rename that missed the preload, or surface nothing uses.
    const invoked = channelsFrom('invoke')
    const orphans = [...harness.handlers.keys()].filter((c) => !invoked.has(c))
    expect(orphans).toEqual([])
  })
})

describe('the Dark Ages installer handlers', () => {
  // The IPC layer added in HTOO-288. The helper itself is covered in
  // daInstaller/, so these are about the boundary: what a malformed payload does,
  // and what happens when two installs race.
  it('refuses an install request that is not the right shape', async () => {
    await expect(harness.invoke('installer:installFromFile', {})).resolves.toMatchObject({
      ok: false,
      reason: 'bad-request'
    })
    await expect(
      harness.invoke('installer:installFromFile', { installerPath: '', destinationDir: '' })
    ).resolves.toMatchObject({ ok: false, reason: 'bad-request' })
    await expect(harness.invoke('installer:installFromFile', null)).resolves.toMatchObject({
      ok: false,
      reason: 'bad-request'
    })
  })

  it('refuses a download request with no destination', async () => {
    await expect(harness.invoke('installer:download', {})).resolves.toMatchObject({
      ok: false,
      reason: 'bad-request'
    })
  })

  it('reports nothing to cancel when no install is running', async () => {
    await expect(harness.invoke('installer:cancel')).resolves.toEqual({
      ok: false,
      reason: 'idle'
    })
  })

  it('turns a failed install into a result rather than an IPC exception', async () => {
    // The renderer branches on `reason`; an exception across IPC arrives as an
    // opaque "Error invoking remote method" string with the reason lost.
    const result = await harness.invoke('installer:installFromFile', {
      installerPath: join(sandbox, 'does-not-exist.exe'),
      destinationDir: join(sandbox, 'out')
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('installer-missing')
    expect(typeof result.message).toBe('string')
  })

  it('runs one install at a time', async () => {
    // Two concurrent installs would write the same staging directory and fight
    // over the same cached download.
    const slow = harness.invoke('installer:installFromFile', {
      installerPath: join(sandbox, 'also-missing.exe'),
      destinationDir: join(sandbox, 'out2')
    })
    const second = harness.invoke('installer:installFromFile', {
      installerPath: join(sandbox, 'another.exe'),
      destinationDir: join(sandbox, 'out3')
    })
    const [first, blocked] = await Promise.all([slow, second])
    // Whichever lost the race reports busy; both cannot have proceeded.
    const reasons = [first.reason, blocked.reason]
    expect(reasons).toContain('busy')
  })
})

describe('a few handlers that guard their input', () => {
  it('rejects a settings payload of the wrong shape', async () => {
    await expect(harness.invoke('settings:save', { theme: 42 })).rejects.toThrow()
  })

  it('answers assets:inspect for a folder that is not there', async () => {
    await expect(harness.invoke('assets:inspect', join(sandbox, 'nope'))).resolves.toEqual({
      ok: false,
      reason: 'missing'
    })
  })

  it('reports the app version the renderer shows in About', async () => {
    await expect(harness.invoke('app:getVersion')).resolves.toBe('2.7.2')
  })

  it('refuses shell:openPath with nothing to open', async () => {
    await expect(harness.invoke('shell:openPath', '')).resolves.toMatchObject({ ok: false })
  })
})

describe('revealing the main window', () => {
  it('shows the main window and tears down the splash on the renderer signal', () => {
    // The boot contract: the window is created hidden and stays hidden until the
    // renderer says it has hydrated its settings, so the user never sees an empty
    // frame. A 15s timer backs it up if the renderer throws first.
    const [splash, main] = harness.windows
    expect(main.visible).toBe(false)

    harness.send('app:ready')

    expect(main.visible).toBe(true)
    expect(splash.isDestroyed()).toBe(true)
  })

  it('is idempotent, so the timeout firing after the signal is harmless', () => {
    const main = harness.windows.at(-1)
    expect(() => harness.send('app:ready')).not.toThrow()
    expect(main.visible).toBe(true)
  })
})
