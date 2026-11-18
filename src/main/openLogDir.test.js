import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInstanceLogDir } from './openLogDir.js'

// HTOO-685. The log-folder button opens a folder from the saved settings,
// never a path from the renderer, and never a program.

let dir
let shell
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'epona-logdir-'))
  shell = { openPath: vi.fn(async () => '') }
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const open = (logDir, extra = {}) =>
  openInstanceLogDir({
    instanceId: 'a',
    loadSettings: async () => ({ instances: [{ id: 'a', logDir }] }),
    shell,
    ...extra
  })

describe('openInstanceLogDir', () => {
  it('opens the saved log folder of the instance', async () => {
    const logs = join(dir, 'logs')
    mkdirSync(logs)
    await expect(open(logs)).resolves.toMatchObject({ ok: true })
    expect(shell.openPath).toHaveBeenCalledWith(logs)
  })

  it('refuses a file, so a program does not run', async () => {
    const exe = join(dir, 'tool.exe')
    writeFileSync(exe, 'MZ')
    await expect(open(exe)).resolves.toMatchObject({ ok: false })
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('refuses a missing folder, an empty setting and an unknown instance', async () => {
    await expect(open(join(dir, 'gone'))).resolves.toMatchObject({ ok: false })
    await expect(open('')).resolves.toMatchObject({ ok: false })
    await expect(open(dir, { instanceId: 'nope' })).resolves.toMatchObject({ ok: false })
    await expect(open(dir, { instanceId: 42 })).resolves.toMatchObject({ ok: false })
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('refuses an application bundle on macOS, and accepts a plain folder there', async () => {
    const app = join(dir, 'Calculator.app')
    mkdirSync(join(app, 'Contents'), { recursive: true })
    writeFileSync(join(app, 'Contents', 'Info.plist'), '<plist/>')
    const renamed = join(dir, 'Logs Folder')
    mkdirSync(join(renamed, 'Contents'), { recursive: true })
    writeFileSync(join(renamed, 'Contents', 'Info.plist'), '<plist/>')
    const plain = join(dir, 'logs')
    mkdirSync(plain)
    await expect(open(app, { platform: 'darwin' })).resolves.toMatchObject({ ok: false })
    await expect(open(renamed, { platform: 'darwin' })).resolves.toMatchObject({ ok: false })
    await expect(open(plain, { platform: 'darwin' })).resolves.toMatchObject({ ok: true })
    expect(shell.openPath).toHaveBeenCalledTimes(1)
    expect(shell.openPath).toHaveBeenCalledWith(plain)
  })
})
