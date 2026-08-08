import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { inspectAssetDir, verifyClientTree, EXPECTED_CLIENT_ARCHIVES } from './daAssets.js'

let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'epona-assets-'))
})

afterEach(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true })
})

describe('inspectAssetDir', () => {
  it('accepts a folder holding Dark Ages data files', async () => {
    await fs.writeFile(join(dir, 'Legend.dat'), '')
    await fs.writeFile(join(dir, 'setoa.dat'), '')
    await expect(inspectAssetDir(dir)).resolves.toEqual({ ok: true, datCount: 2 })
  })

  it('accepts the mixed case a retail install actually writes', async () => {
    // Legend.dat, not legend.dat. Folding the comparison would reject a valid
    // folder on Linux, where the filesystem is the only thing that could tell
    // the difference. See HTOO-287.
    await fs.writeFile(join(dir, 'Legend.DAT'), '')
    await expect(inspectAssetDir(dir)).resolves.toMatchObject({ ok: true })
  })

  it('reports an empty string as unset rather than missing', async () => {
    // The distinction the panel needs: nothing chosen yet is not the same as
    // a folder that has gone away, and the two get different wording.
    await expect(inspectAssetDir('')).resolves.toEqual({ ok: false, reason: 'unset' })
    await expect(inspectAssetDir(undefined)).resolves.toEqual({ ok: false, reason: 'unset' })
  })

  it('reports a path that no longer exists', async () => {
    await expect(inspectAssetDir(join(dir, 'gone'))).resolves.toEqual({
      ok: false,
      reason: 'missing'
    })
  })

  it('reports a file where a folder was expected', async () => {
    // The Windows habit is to pick Dark Ages.exe; doing that here should say so
    // rather than report the folder missing.
    const file = join(dir, 'Dark Ages.exe')
    await fs.writeFile(file, '')
    await expect(inspectAssetDir(file)).resolves.toEqual({
      ok: false,
      reason: 'not-a-directory'
    })
  })

  it('rejects a folder with no data files in it', async () => {
    await fs.writeFile(join(dir, 'readme.txt'), '')
    await expect(inspectAssetDir(dir)).resolves.toEqual({ ok: false, reason: 'no-dat-files' })
  })
})

describe('verifyClientTree', () => {
  // The stricter question, asked straight after an extraction where we know what
  // we wrote. inspectAssetDir stays the lenient one, for the folder picker.
  async function writeArchives(names) {
    for (const name of names) await fs.writeFile(join(dir, name), 'x')
  }

  it('accepts a folder holding every archive a real install has', async () => {
    await writeArchives(EXPECTED_CLIENT_ARCHIVES)
    await expect(verifyClientTree(dir)).resolves.toMatchObject({ ok: true, complete: true })
  })

  it('accepts the mixed case the installer actually writes', async () => {
    // The extraction writes Legend.dat, not legend.dat. Verification has to accept
    // the casing it just produced, or it would reject its own output.
    await writeArchives([
      'Legend.dat',
      'setoa.dat',
      'hades.dat',
      'ia.dat',
      'misc.dat',
      'national.dat',
      'roh.dat',
      'seo.dat',
      'cious.dat',
      'khanpal.dat'
    ])
    await expect(verifyClientTree(dir)).resolves.toMatchObject({ ok: true })
  })

  it('reports which archives a partial tree is missing', async () => {
    await writeArchives(['Legend.dat', 'setoa.dat'])
    const result = await verifyClientTree(dir)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('incomplete-client')
    expect(result.missing).toContain('hades.dat')
    expect(result.missing).not.toContain('legend.dat')
  })

  it('rejects a folder holding unrelated .dat files', async () => {
    // The case that makes this stricter check worth having: inspectAssetDir is
    // satisfied by any .dat at all, which a half-finished extraction would supply.
    await writeArchives(['something.dat', 'other.dat'])
    await expect(inspectAssetDir(dir)).resolves.toMatchObject({ ok: true })
    await expect(verifyClientTree(dir)).resolves.toMatchObject({ reason: 'incomplete-client' })
  })

  it('passes the shape failures straight through', async () => {
    // No second answer to a question inspectAssetDir already answers. HTOO-288.
    await expect(verifyClientTree('')).resolves.toEqual({ ok: false, reason: 'unset' })
    await expect(verifyClientTree(join(dir, 'gone'))).resolves.toEqual({
      ok: false,
      reason: 'missing'
    })
    const file = join(dir, 'Dark Ages.exe')
    await fs.writeFile(file, '')
    await expect(verifyClientTree(file)).resolves.toEqual({ ok: false, reason: 'not-a-directory' })
  })

  it('reports an empty folder as having no data files, not as incomplete', async () => {
    await expect(verifyClientTree(dir)).resolves.toEqual({ ok: false, reason: 'no-dat-files' })
  })
})
