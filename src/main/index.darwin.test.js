import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { rmSync, mkdtempSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// The main process, booted as if on macOS.
//
// process.platform is set to 'darwin' before index.js is imported, because
// index.js reads it at module load and again in whenReady. The electron double
// does not care which platform it runs on, so this runs on the Windows dev box
// and on the POSIX CI job alike.
//
// Its own file because index.js boots once per file, and the platform has to be
// set before that boot.

const sandbox = mkdtempSync(join(tmpdir(), 'epona-darwin-boot-'))

const setup = await vi.hoisted(async () => {
  const { createElectronDouble } = await import('./electronDouble.js')
  const { mkdtempSync: mkdtemp, mkdirSync, writeFileSync } = await import('fs')
  const { join: joinPath } = await import('path')
  const { tmpdir: tmp } = await import('os')
  const pathsBase = mkdtemp(joinPath(tmp(), 'epona-darwin-paths-'))
  // A settings file where the roaming migration looks for one. On macOS that
  // migration must not run: with LOCALAPPDATA redirected (the e2e helper) it
  // would copy the user's real settings into the test's temp dir.
  const roaming = joinPath(pathsBase, 'appData', 'Erisco', 'Epona')
  mkdirSync(roaming, { recursive: true })
  writeFileSync(joinPath(roaming, 'settings.json'), '{"theme":"roaming"}')
  const realPlatform = process.platform
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  return { harness: createElectronDouble({ pathsBase }), realPlatform }
})

const { harness } = setup

vi.mock('electron', () => harness.electron)

beforeAll(async () => {
  process.env.LOCALAPPDATA = sandbox
  await import('./index.js')
  await harness.ready()
})

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: setup.realPlatform, configurable: true })
  rmSync(sandbox, { recursive: true, force: true })
})

describe('booting on macOS', () => {
  it('puts userData under LOCALAPPDATA when it is set', () => {
    const call = harness.app.setPath.mock.calls.find(([key]) => key === 'userData')
    expect(call[1]).toBe(join(sandbox, 'Erisco', 'Epona'))
  })

  it('does not run the roaming settings migration', () => {
    // HTOO-543. Roaming is a Windows concept. Off Windows, a redirected
    // LOCALAPPDATA makes the roaming dir differ from the settings dir, and the
    // migration copied the real settings into the e2e temp dir.
    expect(existsSync(join(sandbox, 'Erisco', 'Epona', 'settings.json'))).toBe(false)
  })
})
